// src/controllers/accountRecoveryController.ts
import { Request, Response } from 'express';
import pool from '../config/db';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { sendEmail } from '../utils/notificationUtils';
import {
  decryptNullable,
  blindIndexEmail,
} from '../utils/crypto';

// ⚠️ Dev only (préférez Redis/DB dédiée pour la prod)
const recoveryStore: Record<string, { email: string; otpHash?: string }> = {};

// Masque une adresse email: garde 2 premiers chars + domaine
const maskEmail = (_: string, a: string, b: string, c: string): string => {
  return a + '*'.repeat(b.length) + c;
};

// util
const sha256Hex = (s: string) =>
  crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// ✅ Étape 1 : Démarrer la récupération
// - credentialType: "username" | "email"
// - value: string
export const startRecovery = async (req: Request, res: Response) => {
  const { credentialType, value } = req.body as {
    credentialType?: 'username' | 'email';
    value?: string;
  };

  if (!credentialType || !value) {
    return res.status(400).json({ error: 'Paramètres manquants.' });
  }

  try {
    let row:
      | {
          id: string;
          email_enc: string | null;
          email_bidx: string | null;
        }
      | undefined;

    if (credentialType === 'username') {
      const r = await pool.query(
        `SELECT id, email_enc, email_bidx
           FROM users
          WHERE username = $1
          LIMIT 1`,
        [value]
      );
      row = r.rows[0];
    } else if (credentialType === 'email') {
      // recherche via blind index
      const bidx = blindIndexEmail(String(value).trim().toLowerCase());
      const r = await pool.query(
        `SELECT id, email_enc, email_bidx
           FROM users
          WHERE email_bidx = $1
          LIMIT 1`,
        [bidx]
      );
      row = r.rows[0];
    } else {
      return res.status(400).json({ error: 'Type de credential invalide.' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    const emailPlain = decryptNullable(row.email_enc) || '';
    if (!emailPlain) {
      return res.status(409).json({ error: 'Email indisponible pour ce compte.' });
    }

    const maskedEmail = emailPlain.replace(
      /(.{2})(.*)(@.*)/,
      maskEmail
    );

    // on garde (en DEV) l’email pour la suite de la procédure
    const recoveryId = crypto.randomBytes(16).toString('hex');
    recoveryStore[recoveryId] = { email: emailPlain };

    return res.json({ maskedEmail, userId: recoveryId });
  } catch (err) {
    console.error('[startRecovery] Erreur:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ✅ Étape 2 : Vérifier l’email (confirmer qu’on contrôle cette boîte) & envoyer OTP
// - userId: string (renvoyé à l’étape 1)
// - verifiedEmail: string (plein)
export const verifyEmailForRecovery = async (req: Request, res: Response) => {
  const { userId, verifiedEmail } = req.body as {
    userId?: string;
    verifiedEmail?: string;
  };

  if (!userId || !verifiedEmail) {
    return res.status(400).json({ error: 'Paramètres manquants.' });
  }

  try {
    const stored = recoveryStore[userId];
    if (!stored || stored.email.toLowerCase().trim() !== verifiedEmail.toLowerCase().trim()) {
      return res.status(400).json({ error: 'Vérification échouée.' });
    }

    // Générer un OTP simple 6 chiffres
    const otp = (Math.floor(100000 + Math.random() * 900000)).toString();
    const otpHash = sha256Hex(otp);
    stored.otpHash = otpHash;

    // Persister côté DB (dans users.recovery_code_hash) via blind index
    const bidx = blindIndexEmail(verifiedEmail.toLowerCase().trim());
    await pool.query(
      `UPDATE users
          SET recovery_code_hash = $1
        WHERE email_bidx = $2`,
      [otpHash, bidx]
    );

    // Envoyer l’OTP par email
    await sendEmail({
      to: verifiedEmail,
      subject: 'Code OTP - Cash Hay',
      text: `Voici votre code de vérification : ${otp}`,
    });

    return res.json({ message: 'Code envoyé à votre email.' });
  } catch (err) {
    console.error('[verifyEmailForRecovery] Erreur:', err);
    return res
      .status(500)
      .json({ error: 'Erreur serveur lors de la vérification.' });
  }
};

// ✅ Étape 3 : Réinitialiser le mot de passe
// - userId: string (étape 1)
// - otp: string
// - newPassword: string
export const resetPassword = async (req: Request, res: Response) => {
  const { userId, otp, newPassword } = req.body as {
    userId?: string;
    otp?: string;
    newPassword?: string;
  };

  if (!userId || !otp || !newPassword) {
    return res.status(400).json({ error: 'Paramètres manquants.' });
  }

  try {
    const stored = recoveryStore[userId];
    if (!stored) {
      return res.status(400).json({ error: 'Session de récupération invalide ou expirée.' });
    }

    const email = stored.email;
    const otpHash = sha256Hex(otp);

    // Vérifier contre la DB
    const bidx = blindIndexEmail(email.toLowerCase().trim());
    const { rows } = await pool.query(
      `SELECT id, recovery_code_hash
         FROM users
        WHERE email_bidx = $1
        LIMIT 1`,
      [bidx]
    );

    if (rows.length === 0 || !rows[0].recovery_code_hash) {
      return res.status(400).json({ error: 'Aucun code actif pour ce compte.' });
    }

    if (rows[0].recovery_code_hash !== otpHash) {
      return res.status(400).json({ error: 'OTP invalide ou expiré.' });
    }

    // OK → Update password & clear recovery_code_hash
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query(
      `UPDATE users
          SET password = $1,
              recovery_code_hash = NULL
        WHERE email_bidx = $2`,
      [hashedPassword, bidx]
    );

    // Nettoyage mémoire DEV
    delete recoveryStore[userId];

    return res.json({ message: 'Mot de passe réinitialisé avec succès.' });
  } catch (err) {
    console.error('[resetPassword] Erreur:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};
