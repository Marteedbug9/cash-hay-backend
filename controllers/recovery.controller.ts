import { Request, Response } from 'express';
import pool from '../config/db';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { sendEmail } from '../utils/notificationUtils';

// ❌ En mémoire pour dev seulement (Redis recommandé en production)
const recoveryStore: Record<string, { email: string; otp?: string }> = {};

// ✨ Masquer une adresse email
const maskEmail = (_: string, a: string, b: string, c: string): string => {
  return a + '*'.repeat(b.length) + c;
};

// ✅ Étape 1 : Lancer la récupération de compte
export const startRecovery = async (req: Request, res: Response) => {
  const { credentialType, value } = req.body;

  try {
    let result;

    if (credentialType === 'username') {
      result = await pool.query('SELECT id, email FROM users WHERE username = $1', [value]);
    } else if (credentialType === 'email') {
      result = await pool.query('SELECT id, email FROM users WHERE email = $1', [value]);
    } else {
      return res.status(400).json({ error: 'Type de credential invalide.' });
    }

    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

    const maskedEmail = user.email.replace(/(.{2})(.*)(@.*)/, maskEmail);
    const recoveryId = crypto.randomBytes(16).toString('hex');
    recoveryStore[recoveryId] = { email: user.email };

    res.json({ maskedEmail, userId: recoveryId });
  } catch (err) {
    console.error('[startRecovery] Erreur:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ✅ Étape 2 : Vérifier l'adresse email
export const verifyEmailForRecovery = async (req: Request, res: Response) => {
  const { userId, verifiedEmail } = req.body;

  try {
    const stored = recoveryStore[userId];
    if (!stored || stored.email !== verifiedEmail) {
      return res.status(400).json({ error: 'Vérification échouée.' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    stored.otp = otp;

    await sendEmail({
      to: verifiedEmail,
      subject: 'Code OTP - Cash Hay',
      text: `Voici votre code de vérification : ${otp}`,
    });

    res.json({ message: 'Code envoyé à votre email.' });
  } catch (err) {
    console.error('[verifyEmailForRecovery] Erreur:', err);
    res.status(500).json({ error: 'Erreur serveur lors de la vérification.' });
  }
};

// ✅ Étape 3 : Réinitialiser le mot de passe
export const resetPassword = async (req: Request, res: Response) => {
  const { userId, otp, newPassword } = req.body;

  try {
    const stored = recoveryStore[userId];
    if (!stored || stored.otp !== otp) {
      return res.status(400).json({ error: 'OTP invalide ou expiré.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password = $1 WHERE email = $2', [hashedPassword, stored.email]);

    delete recoveryStore[userId];
    res.json({ message: 'Mot de passe réinitialisé avec succès.' });
  } catch (err) {
    console.error('[resetPassword] Erreur:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};