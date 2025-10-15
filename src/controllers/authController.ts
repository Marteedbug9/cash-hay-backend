// imports: GARDE
import { RequestHandler, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { generateOTP } from '../utils/otpUtils';
import bcrypt from 'bcrypt';
import pool from '../config/db';
import { sendEmail, sendSMS } from '../utils/notificationUtils';
import { v4 as uuidv4 } from 'uuid';
import cloudinary from '../config/cloudinary';
import requestIp from 'request-ip';
import streamifier from 'streamifier';
import { CardStatus, CardType } from '../constants/card';
import { encrypt, encryptNullable, decryptNullable, blindIndexEmail, blindIndexPhone } from '../utils/crypto';
import type { File as MulterFile } from 'multer';
import { sha256Hex, timingSafeEqualHex, normalizeOtp} from '../utils/security';
import { buildWelcomeEmail } from '../templates/emails/welcomeEmail';




// imports: RETIRE
import { File } from 'multer';            // inutile: tu utilises Express.Multer.File
// import db from '../config/db';            // doublon de pool
// import { toEmailEncBidx, ... } from '../utils/pii'; // tu n’utilises pas
// import { sha256Hex, ... } from '../utils/security'; // tu n’utilises pas
// import crypto from 'crypto';               // n’utilise plus AES-CBC ici


// Exemple simple de génération de carte et date
const generateCardNumber = (): string => {
  return '42' + Math.floor(100000000000 + Math.random() * 900000000000); // Exemple: 42123456789012
};

const generateExpiryDate = (): string => {
  const now = new Date();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const year = (now.getFullYear() + 4).toString().slice(2); // Ex: '29'
  return `${month}/${year}`; // Format MM/YY
};

const usernameRegex = /^[a-zA-Z0-9@#%&._-]{3,30}$/;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getClientIp(req: Request): string {
  const xf = (req.headers['x-forwarded-for'] as string) || '';
  return (xf.split(',')[0] || req.ip || '').trim();
}

async function createSuspiciousIPAlert(
  userRow: any,
  ipAddress: string,
  userAgent?: string
) {
  const email = decryptNullable(userRow.email_enc) ?? userRow.email ?? '';
  const phone = decryptNullable(userRow.phone_enc) ?? userRow.phone ?? '';

  // Insère l’alerte
  const ins = await pool.query(
    `INSERT INTO alerts (user_id, contact_attempt, raw_response, created_at, updated_at)
     VALUES ($1, $2, NULL, NOW(), NOW())
     RETURNING id`,
    [userRow.id, ipAddress]
  );
  const alertId = ins.rows[0].id;

  // Log
  await pool.query(
    `INSERT INTO audit_logs (user_id, action, details, ip_address, user_agent, created_at)
     VALUES ($1, 'suspicious_ip_alert_created', $2, $3, $4, NOW())`,
    [userRow.id, `Nouvelle IP détectée: ${ipAddress} (alert_id=${alertId})`, ipAddress, userAgent || 'N/A']
  );

  // Best-effort notifications
  const jobs: Promise<any>[] = [];
  if (email) {
    jobs.push(
      sendEmail({
        to: email,
        subject: 'Alerte Sécurité Cash Hay',
        text: `Connexion depuis une nouvelle IP (${ipAddress}). Si c'est vous, répondez Y au SMS. Sinon, répondez N.`
      }).catch(e => console.error('❌ Email alerte échoué:', e))
    );
  }
  if (phone) {
    jobs.push(
      sendSMS(
        phone,
        `Alerte sécurité Cash Hay : Connexion depuis une nouvelle IP (${ipAddress}). Répondez Y pour autoriser, N pour bloquer.`
      ).catch(e => console.error('❌ SMS alerte échoué:', e))
    );
  }
  await Promise.all(jobs);
}


// ➤ Enregistrement
export const register = async (req: Request, res: Response) => {
  console.log('🟡 Données reçues:', req.body);

  const {
    first_name, last_name, gender,
    address, city, department, zip_code = '',
    country, email, phone,
    birth_date, birth_country,
    id_type, id_number, id_issue_date, id_expiry_date,
    username, password,
    accept_terms,
  } = req.body;

  // --- validations rapides ---
  const usernameRegex = /^[a-zA-Z0-9@#%&._-]{3,30}$/;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!username || !usernameRegex.test(username)) {
    return res.status(400).json({ error: "Nom d’utilisateur invalide." });
  }
  if (!email || !emailRegex.test(email)) {
    return res.status(400).json({ error: 'Email invalide.' });
  }
  if (accept_terms !== true) {
    return res.status(400).json({ error: 'Vous devez accepter les conditions.' });
  }
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: 'Mot de passe trop court (min. 8 caractères).' });
  }

  const required = {
    first_name, last_name, gender, address, city, department, country,
    phone, birth_date, birth_country, id_type, id_number, id_issue_date, id_expiry_date,
  };
  for (const [k, v] of Object.entries(required)) {
    if (v == null || v === '') {
      return res.status(400).json({ error: `Le champ "${k}" est requis.` });
    }
  }

  const client = await pool.connect();
  try {
    // 🔒 préparer chiffrage / index aveugle (normalisés)
    const emailNorm = String(email).trim().toLowerCase();
    const phoneNorm = String(phone);
    const emailBidx = blindIndexEmail(emailNorm);
    const phoneBidx = blindIndexPhone(phoneNorm);

    // doublons via bidx + username
    const dupe = await client.query(
      `SELECT 1 FROM users WHERE email_bidx = $1 OR phone_bidx = $2 OR username = $3 LIMIT 1`,
      [emailBidx, phoneBidx, username]
    );
    if (dupe.rowCount && dupe.rowCount > 0) {
      return res.status(400).json({ error: 'Email, téléphone ou nom d’utilisateur déjà utilisé.' });
    }

    await client.query('BEGIN');

    const userId   = uuidv4();
    const memberId = uuidv4();
    const cardId   = uuidv4();
    const hashedPassword = await bcrypt.hash(String(password), 10);

    // Pour récupération de compte : on stocke hash seulement
    const recoveryCode = uuidv4();
    const recoveryCodeHash = sha256Hex(recoveryCode);

    // 1) USERS — plain + colonnes chiffrées/bidx
    await client.query(
      `
      INSERT INTO users (
        id,
        username,
        first_name, last_name,
        gender,
        address, city, department, zip_code, country,
        email,         email_enc,  email_bidx,
        phone,         phone_enc,  phone_bidx,
        birth_date,    birth_country,
        id_type,       id_number,  id_number_enc, id_issue_date, id_expiry_date,
        password_hash, role, accept_terms,
        recovery_code, recovery_code_hash,
        created_at
      ) VALUES (
        $1,$2,
        $3,$4,
        $5,
        $6,$7,$8,$9,$10,
        $11,$12,$13,
        $14,$15,$16,
        $17,$18,
        $19,$20,$21,$22,$23,
        $24,$25,$26,
        $27,$28,
        NOW()
      )
      `,
      [
        userId,
        username,
        first_name, last_name,
        gender,
        address, city, department, zip_code, country,
        emailNorm,  encrypt(emailNorm), emailBidx,
        phoneNorm,  encrypt(phoneNorm), phoneBidx,
        birth_date, birth_country,
        id_type,    id_number,          encrypt(id_number), id_issue_date, id_expiry_date,
        hashedPassword, 'user', true, // accept_terms validé plus haut
        recoveryCode, recoveryCodeHash,
      ]
    );

    // 2) CARDS (placeholder legacy)
    const legacyNumber = '42' + Math.floor(100000000000 + Math.random() * 900000000000);
    const now = new Date();
    const expiry = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getFullYear() + 4).slice(2)}`;

    await client.query(
      `INSERT INTO cards (id, user_id, legacy_card_number, expiry_date, type, account_type, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
      [cardId, userId, legacyNumber, expiry, 'virtual', 'checking', 'pending']
    );

    // 3) BALANCES
    await client.query('INSERT INTO balances (user_id, amount) VALUES ($1, $2)', [userId, 0]);

    // 4) MEMBERS (contact non défini ici ; pourra être complété plus tard)
    await client.query(
      `INSERT INTO members (id, user_id, display_name, created_at, updated_at)
       VALUES ($1,$2,$3,NOW(),NOW())`,
      [memberId, userId, username]
    );

    // 5) LOGIN HISTORY
    const ipAddress = requestIp.getClientIp(req) || req.ip || '';
    await client.query(
      `INSERT INTO login_history (user_id, ip_address, created_at) VALUES ($1, $2, NOW())`,
      [userId, ipAddress]
    );

    await client.query('COMMIT');

    // ✅ notifications post-commit (best-effort, non bloquant)
    const reward  = Number(process.env.WELCOME_REWARD_HTG ?? '25');
    const loginUrl = process.env.APP_LOGIN_URL || 'https://app.cash-hay.com/login';

    void (async () => {
      // Email HTML de bienvenue
      try {
        const { subject, text, html } = buildWelcomeEmail({
          firstName: first_name ?? '',
          loginUrl,
          reward,
        });
        await sendEmail({ to: emailNorm, subject, text, html });
        console.log('📨 Email de bienvenue envoyé à', emailNorm);
      } catch (e) {
        console.warn('⚠️ Email de bienvenue non envoyé :', (e as any)?.message || e);
      }

      // SMS court de bienvenue (optionnel)
      try {
        await sendSMS(
          phoneNorm,
          `Bienvenue ${first_name}! Connectez-vous: ${loginUrl}. Votre identité doit encore être validée pour activer le compte.`
        );
      } catch (e) {
        console.warn('⚠️ SMS bienvenue non envoyé :', (e as any)?.message || e);
      }
    })();

    return res.status(201).json({
      user: { id: userId, email: emailNorm, first_name, last_name, username }
    });
  } catch (err: any) {
    try { await client.query('ROLLBACK'); } catch {}
    if (err?.code === '23505') {
      // au cas où l’index unique bidx remonte une violation
      return res.status(400).json({ error: 'Email, téléphone ou nom d’utilisateur déjà utilisé.' });
    }
    console.error('❌ Erreur SQL :', err?.message || err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  } finally {
    client.release();
  }
};




// ➤ Connexion
export const login = async (req: Request, res: Response) => {
  console.log('🟡 Requête login reçue avec :', req.body);
  const { username, password } = req.body;
  const ip = requestIp.getClientIp(req) || req.ip || '';

  try {
    // 1️⃣ Recherche utilisateur
    const result = await pool.query(
      `SELECT
         id, username, role, password_hash,
         is_deceased, is_blacklisted, is_otp_verified,
         photo_url, is_verified, verified_at, identity_verified,
         email, phone, first_name, last_name,
         email_enc, phone_enc
       FROM users
       WHERE username = $1`,
      [username]
    );

    if (result.rowCount === 0)
      return res.status(401).json({ error: 'Nom d’utilisateur ou mot de passe incorrect.' });

    const user = result.rows[0];

    // 2️⃣ Vérification mot de passe
    const isMatch = await bcrypt.compare(String(password), user.password_hash);
    if (!isMatch)
      return res.status(401).json({ error: 'Nom d’utilisateur ou mot de passe incorrect.' });

    if (user.is_deceased)
      return res.status(403).json({ error: 'Ce compte est marqué comme décédé.' });
    if (user.is_blacklisted)
      return res.status(403).json({ error: 'Ce compte est sur liste noire.' });

    // 3️⃣ Vérifie si l’adresse IP est nouvelle
    const ipResult = await pool.query(
      'SELECT 1 FROM login_history WHERE user_id = $1 AND ip_address = $2',
      [user.id, ip]
    );
    const isNewIP = ipResult.rowCount === 0;
    const requiresOTP = !user.is_otp_verified || isNewIP;

    // 4️⃣ Si OTP requis
    if (requiresOTP) {
      const otp = generateOTP();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
      const codeHash = sha256Hex(normalizeOtp(otp));

      // Nettoyage ancien OTP (si existant)
      await pool.query('DELETE FROM otps WHERE user_id = $1', [user.id]);

      // 🟩 Insertion avec code_hash (et non plus code)
      await pool.query(
        `INSERT INTO otps (user_id, code_hash, created_at, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id)
         DO UPDATE SET code_hash = EXCLUDED.code_hash,
                       created_at = EXCLUDED.created_at,
                       expires_at = EXCLUDED.expires_at`,
        [user.id, codeHash, now, expiresAt]
      );

      // 5️⃣ Récupération des contacts
      const email = decryptNullable(user.email_enc) ?? user.email ?? '';
      const phone = decryptNullable(user.phone_enc) ?? user.phone ?? '';

      // 6️⃣ Envoi OTP (non bloquant)
      const tasks: Promise<any>[] = [];
      if (email) {
        tasks.push(
          sendEmail({
            to: email,
            subject: 'Code de vérification - Cash Hay',
            text: `Votre code est : ${otp} (valide 10 minutes)`,
          }).catch(e => console.error('❌ Envoi email OTP échoué :', e?.message || e))
        );
      }
      if (phone) {
        tasks.push(
          sendSMS(phone, `Cash Hay : Votre code OTP est ${otp} (10 min)`)
            .catch(e => console.error('❌ Envoi SMS OTP échoué :', e?.message || e))
        );
      }
      await Promise.all(tasks);

      console.log(`📩 OTP login envoyé à ${email || '(pas d’email)'} / ${phone || '(pas de téléphone)'} : ${otp}`);

      // 7️⃣ Déclenche une alerte si IP nouvelle
      if (isNewIP) {
        try {
          await createSuspiciousIPAlert(user, ip, req.headers['user-agent'] as string);
        } catch (e) {
          console.error('⚠️ Création alerte IP échouée:', e);
        }
      }
    } else {
      // IP déjà connue, connexion directe
      await pool.query(
        'INSERT INTO login_history (user_id, ip_address) VALUES ($1, $2)',
        [user.id, ip]
      );
    }

    // 8️⃣ Prépare la réponse
    const email = decryptNullable(user.email_enc) ?? user.email ?? '';
    const phone = decryptNullable(user.phone_enc) ?? user.phone ?? '';
    const firstName = user.first_name ?? '';
    const lastName = user.last_name ?? '';

    const token = jwt.sign(
      { id: user.id, email, role: user.role || 'user', is_otp_verified: user.is_otp_verified || false },
      process.env.JWT_SECRET || 'devsecretkey',
      { expiresIn: '1h' }
    );

    const maskUsername = (name: string): string =>
      name.length <= 4 ? name : name.slice(0, 4) + '*'.repeat(name.length - 4);

    // ✅ Réponse finale
    return res.status(200).json({
      message: 'Connexion réussie',
      requiresOTP,
      token,
      user: {
        id: user.id,
        username: maskUsername(user.username),
        email,
        phone,
        first_name: firstName,
        last_name: lastName,
        photo_url: user.photo_url || null,
        is_verified: user.is_verified || false,
        verified_at: user.verified_at || null,
        identity_verified: user.identity_verified || false,
        is_otp_verified: user.is_otp_verified || false,
        role: user.role || 'user',
      },
    });
  } catch (error: any) {
    console.error('❌ Erreur dans login:', error?.message || error);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};



// ➤ Récupération de profil
export const getProfile = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Utilisateur non authentifié.' });

  try {
    const { rows } = await pool.query(
      `
      SELECT
        u.id,
        u.username,
        -- champs potentiellement chiffrés + fallback en clair
        u.email,       u.email_enc,
        u.phone,       u.phone_enc,
        u.address,     u.address_enc,
        -- noms non chiffrés dans ton schéma actuel
        u.first_name,  u.last_name,
        u.photo_url,
        u.is_verified, u.verified_at, u.identity_verified,
        m.contact
      FROM users u
      LEFT JOIN members m ON m.user_id = u.id
      WHERE u.id = $1
      `,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé.' });
    }

    const r = rows[0];

    // Déchiffre si présent, sinon fallback vers la colonne en clair
    const email   = decryptNullable(r.email_enc)   ?? r.email   ?? '';
    const phone   = decryptNullable(r.phone_enc)   ?? r.phone   ?? '';
    const address = decryptNullable(r.address_enc) ?? r.address ?? '';

    const fullName = [r.first_name, r.last_name].filter(Boolean).join(' ');

    return res.json({
      user: {
        id: r.id,
        username: r.username,
        email,
        phone,
        address,
        first_name: r.first_name ?? '',
        last_name:  r.last_name  ?? '',
        full_name:  fullName,
        contact:    r.contact ?? '',
        photo_url:  r.photo_url || null,
        is_verified:        !!r.is_verified,
        verified_at:        r.verified_at || null,
        identity_verified:  !!r.identity_verified,
      },
    });
  } catch (err) {
    console.error('❌ Erreur profil:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};


// ➤ Démarrer récupération de compte
export const startRecovery: RequestHandler = async (req: Request, res: Response) => {
  const { credentialType, value } = req.body;
  try {
    let userRow: any;
    if (credentialType === 'username') {
      const r = await pool.query('SELECT id, email_enc FROM users WHERE username = $1', [value]);
      userRow = r.rows[0];
    } else {
      const bidx = blindIndexEmail(String(value).trim().toLowerCase());
      const r = await pool.query('SELECT id, email_enc FROM users WHERE email_bidx = $1', [bidx]);
      userRow = r.rows[0];
    }
    if (!userRow) return res.status(404).json({ error: 'Utilisateur non trouvé.' });

    await pool.query(
      `INSERT INTO logs_security (user_id, action, ip_address, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [userRow.id, 'start_recovery', req.ip]
    );

    const email = decryptNullable(userRow.email_enc) ?? '';
    const maskedEmail = email
      ? email.replace(/^(.{2}).*(@.*)$/, (_, a, b) => `${a}***${b}`)
      : '***@***';

    res.json({ message: 'Email masqué envoyé.', maskedEmail, userId: userRow.id });
  } catch (err) {
    console.error('❌ Erreur startRecovery:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};


// ➤ Envoi OTP pour récupération
export const verifyEmailForRecovery: RequestHandler = async (req: Request, res: Response) => {
  const { userId, verifiedEmail } = req.body;
  try {
    const r = await pool.query('SELECT email_bidx, phone_enc, email_enc FROM users WHERE id = $1', [userId]);
    const u = r.rows[0];
    if (!u) return res.status(404).json({ error: 'Utilisateur non trouvé.' });

    const providedBidx = blindIndexEmail(String(verifiedEmail).trim().toLowerCase());
    if (u.email_bidx !== providedBidx) {
      return res.status(401).json({ error: 'Adresse email non valide.' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await pool.query('INSERT INTO otps (user_id, code, created_at, expires_at) VALUES ($1,$2,NOW(), NOW()+INTERVAL \'10 minutes\')', [userId, otp]);

    const email = decryptNullable(u.email_enc) ?? '';
    const phone = decryptNullable(u.phone_enc) ?? '';

    await sendEmail({ to: email, subject: 'Code OTP - Cash Hay', text: `Votre code est : ${otp}` });
    if (phone) await sendSMS(phone, `Cash Hay : Votre code OTP est : ${otp}`);

    res.json({ message: 'Code OTP envoyé par SMS et Email.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};


// ➤ Réinitialisation mot de passe
export const resetPassword: RequestHandler = async (req: Request, res: Response) => {
  const { userId, otp, newPassword } = req.body;

  try {
    const otpRes = await pool.query(
      'SELECT * FROM otps WHERE user_id = $1 AND code = $2 ORDER BY created_at DESC LIMIT 1',
      [userId, otp]
    );

    if (otpRes.rows.length === 0 || new Date(otpRes.rows[0].expires_at) < new Date()) {
      await pool.query(
        `INSERT INTO logs_security (user_id, action, ip_address, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [userId, 'reset_password_failed_otp', req.ip]
      );
      return res.status(400).json({ error: 'Code OTP invalide ou expiré.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);

    await pool.query('DELETE FROM otps WHERE user_id = $1', [userId]);

    await pool.query(
      `INSERT INTO logs_security (user_id, action, ip_address, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [userId, 'reset_password_success', req.ip]
    );

    res.json({ message: 'Mot de passe réinitialisé avec succès.' });
  } catch (err) {
    console.error('❌ Erreur resetPassword:', err);

    await pool.query(
      `INSERT INTO logs_security (user_id, action, ip_address, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [userId || null, 'reset_password_error', req.ip]
    );

    res.status(500).json({ error: 'Erreur serveur.' });
  }
};



// ➤ Upload de pièce d'identité + activation
export const uploadIdentity = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    type IdentityFiles = Record<'face' | 'document' | string, MulterFile[]>;
    const files = (req.files || {}) as IdentityFiles;

    const faceFile = files.face?.[0];
    const documentFile = files.document?.[0];

    if (!faceFile || !documentFile) {
      return res.status(400).json({ error: 'Photos manquantes (visage ou pièce).' });
    }

    const uploadToCloudinary = (fileBuffer: Buffer, folder: string): Promise<string> => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder },
          (error, result) => {
            if (error || !result) return reject(error);
            resolve(result.secure_url);
          }
        );
        stream.end(fileBuffer);
      });
    };

    const [faceUrl, documentUrl] = await Promise.all([
      uploadToCloudinary(faceFile.buffer, 'cash-hay/identities/face'),
      uploadToCloudinary(documentFile.buffer, 'cash-hay/identities/document'),
    ]);

    await pool.query(
      `UPDATE users 
         SET face_url = $1,
             document_url = $2,
             identity_verified = false,
             is_verified = false,
             verified_at = NULL,
             identity_request_enabled = false
       WHERE id = $3`,
      [faceUrl, documentUrl, userId]
    );

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        userId,
        'upload_identity',
        'Vérification identité : photo visage et pièce soumises.',
        ip?.toString(),
        userAgent || 'N/A',
      ]
    );

    return res.status(200).json({
      message: 'Documents soumis avec succès. En attente de validation.',
      faceUrl,
      documentUrl,
    });
  } catch (error) {
    console.error('❌ Erreur upload identité:', error);
    return res.status(500).json({ error: 'Erreur lors de l’envoi des fichiers.' });
  }
};


// ➤ Renvoyer un code OTP

export const resendOTP: RequestHandler = async (req: Request, res: Response) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'ID utilisateur requis.' });

  try {
    // Récupère contacts avec fallback pour anciens comptes
    const { rows } = await pool.query(
      'SELECT email_enc, phone_enc, email, phone FROM users WHERE id = $1',
      [userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Utilisateur non trouvé.' });

    const row = rows[0];
    const email = decryptNullable(row.email_enc) ?? row.email ?? '';
    const phone = decryptNullable(row.phone_enc) ?? row.phone ?? '';

    if (!email && !phone) {
      return res.status(400).json({ error: 'Aucun contact (email/téléphone) associé au compte.' });
    }

    // Génère / stocke un nouvel OTP (10 min) et supprime l’ancien
    const otp = generateOTP();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);

    await pool.query('DELETE FROM otps WHERE user_id = $1', [userId]);
    await pool.query(
      `INSERT INTO otps (user_id, code, created_at, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [userId, otp, now, expiresAt]
    );

    // Envois best-effort (email + SMS si disponibles)
    const tasks: Promise<any>[] = [];
    if (email) {
      tasks.push(
        sendEmail({
          to: email,
          subject: 'Code de vérification - Cash Hay',
          text: `Votre code est : ${otp} (valide 10 minutes)`
        }).catch(e => console.error('❌ Envoi email OTP échoué :', e?.message || e))
      );
    }
    if (phone) {
      tasks.push(
        sendSMS(phone, `Cash Hay : Votre code OTP est ${otp} (valide 10 minutes)`)
          .catch(e => console.error('❌ Envoi SMS OTP échoué :', e?.message || e))
      );
    }
    await Promise.allSettled(tasks);

    console.log(`📩 OTP renvoyé à ${email || '(pas d’email)'} / ${phone || '(pas de phone)'}`);
    return res.status(200).json({ message: 'Code renvoyé avec succès.', expiresAt });
  } catch (err: any) {
    console.error('❌ Erreur lors du renvoi OTP:', err?.message || err);
    return res.status(500).json({ error: 'Erreur serveur lors du renvoi du code.' });
  }
};




// ➤ Confirmation de sécurité (réponse Y ou N

export const confirmSuspiciousAttempt: RequestHandler = async (req: Request, res: Response) => {
  const { userId, response } = req.body;

  if (!userId || !['Y', 'N'].includes(response)) {
    return res.status(400).json({ error: 'Requête invalide.' });
  }

  try {
    const result = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    if (response === 'N') {
      await pool.query('UPDATE users SET is_blacklisted = true WHERE id = $1', [userId]);
      return res.status(200).json({ message: 'Compte bloqué. Veuillez contacter le support.' });
    } else {
      return res.status(200).json({ message: 'Tentative confirmée. Accès restauré après le délai.' });
    }
  } catch (err) {
    console.error('Erreur de confirmation de sécurité :', err);
    res.status(500).json({ error: 'Erreur serveur lors de la confirmation.' });
  }
};

// ➤ Vérification OTP après login

// ➤ Vérification OTP après login
export const verifyOTP: RequestHandler = async (req: Request, res: Response) => {
  const { userId, code } = req.body;
  if (!userId || !code)
    return res.status(400).json({ error: 'ID utilisateur et code requis.' });

  try {
    // 1️⃣ Vérifie OTP (hashé)
    const otpRes = await pool.query(
      'SELECT code_hash, expires_at FROM otps WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [userId]
    );
    if (otpRes.rowCount === 0)
      return res.status(400).json({ valid: false, reason: 'Aucun code trouvé.' });

    const { code_hash, expires_at } = otpRes.rows[0];

    // Vérifie expiration
    if (new Date() > new Date(expires_at))
      return res.status(400).json({ error: 'Code expiré.' });

    // Compare les hash de manière sécurisée (constant-time)
    const candidate = sha256Hex(normalizeOtp(code));
    const match = timingSafeEqualHex(code_hash, candidate);
    if (!match)
      return res.status(400).json({ error: 'Code invalide.' });

    // 2️⃣ Gate alerte IP (⏱ 60 secondes)
    const GATE_WINDOW_MS = 60 * 1000;
    const { rows: alerts } = await pool.query(
      `SELECT id, response, created_at
         FROM alerts
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId]
    );

    if (alerts.length) {
      const last = alerts[0];
      const ageMs = Date.now() - new Date(last.created_at).getTime();
      const withinGate = ageMs <= GATE_WINDOW_MS;

      if (withinGate) {
        if (last.response === 'N') {
          return res.status(403).json({
            error:
              "Connexion bloquée : tentative suspecte signalée (réponse N). Contactez le support."
          });
        }
        if (last.response !== 'Y') {
          return res.status(403).json({
            error:
              "Confirmez la connexion en répondant 'Y' au SMS d'alerte, ou attendez 60 s pour valider via OTP.",
            waitMs: Math.max(GATE_WINDOW_MS - ageMs, 0)
          });
        }
      } else {
        // 60 s écoulées, pas de réponse → on marque TIMEOUT (non bloquant)
        if (!last.response) {
          try {
            await pool.query(
              `UPDATE alerts SET response = 'TIMEOUT' WHERE id = $1`,
              [last.id]
            );
          } catch {
            /* ignore */
          }
        }
      }
    }

    // 3️⃣ Marque l’utilisateur comme otp_verified
    await pool.query('UPDATE users SET is_otp_verified = true WHERE id = $1', [userId]);

    // Supprime l’OTP utilisé
    await pool.query('DELETE FROM otps WHERE user_id = $1', [userId]);

    // 4️⃣ Charge l’utilisateur et génère le token JWT
    const userRes = await pool.query(
      `SELECT id, username, role, email, email_enc, phone, phone_enc,
              first_name, last_name, photo_url, is_verified, identity_verified, identity_request_enabled
         FROM users
        WHERE id = $1`,
      [userId]
    );
    const user = userRes.rows[0];
    const email = decryptNullable(user.email_enc) ?? user.email ?? '';
    const phone = decryptNullable(user.phone_enc) ?? user.phone ?? '';

    const token = jwt.sign(
      { id: user.id, email, role: user.role, is_otp_verified: true },
      process.env.JWT_SECRET || 'devsecretkey',
      { expiresIn: '24h' }
    );

    // 5️⃣ Log de sécurité
    await pool.query(
      `INSERT INTO logs_security (user_id, action, ip_address, created_at)
       VALUES ($1, 'verify_otp', $2, NOW())`,
      [userId, req.ip]
    );

    // ✅ Réponse finale
    return res.status(200).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email,
        phone,
        first_name: user.first_name ?? '',
        last_name: user.last_name ?? '',
        photo_url: user.photo_url || null,
        is_verified: !!user.is_verified,
        is_otp_verified: true,
        identity_verified: !!user.identity_verified,
        identity_request_enabled: user.identity_request_enabled ?? true,
        role: user.role || 'user'
      }
    });
  } catch (err: any) {
    console.error('❌ Erreur vérification OTP:', err?.message || err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};




// ➤ Vérification  validation ID
export const validateIdentity = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    await pool.query(
      `UPDATE users SET identity_verified = true, verified_at = NOW() WHERE id = $1`,
      [id]
    );

    return res.status(200).json({ message: 'Identité validée avec succès.' });
  } catch (err) {
    console.error('❌ Erreur validation identité:', err);
    res.status(500).json({ error: 'Erreur lors de la validation.' });
  }
};



// 📤 Upload photo de profil
export const uploadProfileImage = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'Aucune image reçue' });
    }

    // Nomme chaque image par UUID unique (pas par user, pour garder l’historique Cloudinary)
    const public_id = `profile_${userId}_${uuidv4()}`;

    const uploadFromBuffer = (fileBuffer: Buffer): Promise<any> => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: 'cash-hay/profiles',
            public_id,
            resource_type: 'image',
            format: 'jpg',
            overwrite: false, // NE PAS écraser l’ancienne
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );
        streamifier.createReadStream(fileBuffer).pipe(stream);
      });
    };

    const result = await uploadFromBuffer(file.buffer);

    // Archive toutes les anciennes images de ce user
    await pool.query(
      `UPDATE profile_images SET is_current = false WHERE user_id = $1`,
      [userId]
    );

    // Ajoute la nouvelle image comme current
    await pool.query(
      `INSERT INTO profile_images (user_id, url, is_current) VALUES ($1, $2, true)`,
      [userId, result.secure_url]
    );

    // Mets à jour le champ users.photo_url (pour la photo actuelle)
    await pool.query(
      'UPDATE users SET photo_url = $1 WHERE id = $2',
      [result.secure_url, userId]
    );

    // Récupère l'utilisateur à jour
    const updatedUser = await pool.query(
      'SELECT id, first_name, last_name, photo_url FROM users WHERE id = $1',
      [userId]
    );

    res.status(200).json({
      message: 'Image de profil mise à jour avec succès',
      user: updatedUser.rows[0],
      imageUrl: result.secure_url,
    });
  } catch (err) {
    console.error('❌ Erreur upload image :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// 🔍 Recherche d'utilisateur par contact (minimal, sécurisé)
export const searchUserByContact = async (req: Request, res: Response) => {
  const contacts: string[] = req.body.contacts;
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ error: 'Aucun contact fourni.' });
  }

  try {
    // normalisation simple (emails en lowercase, on laisse tel "as-is" si tu préfères)
    const uniqueContacts = [...new Set(contacts.map(c => c.trim().toLowerCase()))];

    const query = `
      SELECT
        m.contact,           -- ce que l'appelant a cherché
        u.first_name,        -- en clair, pas *_enc
        u.last_name,
        u.photo_url
      FROM members m
      LEFT JOIN users u ON m.user_id = u.id
      WHERE m.contact = ANY($1)
      ORDER BY m.contact
    `;

    const { rows } = await pool.query(query, [uniqueContacts]);

    // Ne renvoyer que le minimum nécessaire
    const users = rows.map(r => ({
      contact: r.contact,
      first_name: r.first_name ?? '',
      last_name:  r.last_name  ?? '',
      full_name: [r.first_name, r.last_name].filter(Boolean).join(' '),
      photo_url: r.photo_url || null,
    }));

    return res.status(200).json({ users });
  } catch (err) {
    console.error('❌ Erreur batch contacts :', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};



// 1️⃣ ENVOI OTP
export const sendOTPRegister = async (req: Request, res: Response) => {
  const { contact } = req.body;
  if (!contact) return res.status(400).json({ error: 'Contact requis' });

  const isEmail = contact.includes('@');
  const normalizedContact = isEmail
    ? contact.trim().toLowerCase()
    : contact.replace(/\D/g, '');

  const now = new Date();

  try {
    // 1️⃣ Vérifier unicité sur la table members SEULEMENT
    const memberQuery = await pool.query(
      `SELECT user_id FROM members WHERE contact = $1`,
      [normalizedContact]
    );
    if (memberQuery.rows.length > 0) {
      return res.status(400).json({
        error: "Ce nom Cash Hay est déjà utilisé par un autre client, utilisez-en un autre."
      });
    }

    // 2️⃣ Vérifier si un OTP est déjà actif pour ce contact
    const otpQuery = await pool.query(
      `SELECT * FROM otps WHERE contact_members = $1 AND expires_at > $2`,
      [normalizedContact, now]
    );
    const activeOtp = otpQuery.rows[0];

    let otp = '';
    let expiresAt: Date;

    if (activeOtp) {
      otp = activeOtp.code;
      expiresAt = activeOtp.expires_at;
    } else {
      otp = generateOTP();
      expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      // Associer l’OTP à user_id si existant (facultatif pour l’inscription membre)
      // 👇 Ici tu peux retirer la recherche dans users si tu veux.
      // Si tu veux garder pour tracking ou analytics laisse-le, mais ce n’est plus une contrainte !
      let existingId: string | null = null;
      // const userInfo = await pool.query(
      //   `SELECT * FROM users WHERE ${isEmail ? 'email' : 'phone'} = $1`,
      //   [normalizedContact]
      // );
      // const existingUser = userInfo.rows[0];
      // existingId = existingUser?.id || null;

      await pool.query(
        `INSERT INTO otps (user_id, contact_members, code, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (contact_members) DO UPDATE
         SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at`,
        [existingId, normalizedContact, otp, expiresAt]
      );
    }

    // 3️⃣ Envoi OTP seulement si non actif
    if (!activeOtp) {
      if (isEmail) {
        await sendEmail({
          to: contact,
          subject: 'Votre code OTP Cash Hay',
          text: `Votre code est : ${otp}`
        });
      } else {
        await sendSMS(contact, `Votre code OTP Cash Hay est : ${otp}`);
      }
    }

    return res.status(200).json({
      message: activeOtp
        ? 'OTP déjà envoyé (toujours actif).'
        : 'OTP envoyé.',
      expiresAt
    });
  } catch (err) {
    console.error('❌ Erreur sendOTPRegister:', err);
    res.status(500).json({ error: "Erreur lors de l’envoi du code." });
  }
};






// 2️⃣ VERIF OTP + CRÉATION MEMBRE + INSERT ID DANS USERS
export const verifyOTPRegister = async (req: Request, res: Response) => {
  const { contact, otp } = req.body;
  const userId = req.user?.id;
  const isEmail = contact.includes('@');

  if (!contact || !otp) {
    return res.status(400).json({ error: 'Contact ou OTP manquant.' });
  }
  if (!userId) {
    console.log('[verifyOTPRegister] ❌ Utilisateur non authentifié (token absent)');
    return res.status(401).json({ error: 'Utilisateur non authentifié.' });
  }

  const normalizedContact = isEmail
    ? contact.trim().toLowerCase()
    : contact.replace(/\D/g, '');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1️⃣ Vérifie OTP
    const otpRes = await client.query(
      `SELECT * FROM otps WHERE contact_members = $1 ORDER BY expires_at DESC LIMIT 1`,
      [normalizedContact]
    );
    console.log('[verifyOTPRegister] otpRes:', otpRes.rows);

    if (otpRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Aucun code trouvé pour ce contact.' });
    }
    const { code, expires_at } = otpRes.rows[0];
    if (String(code).trim() !== String(otp).trim() || new Date() > new Date(expires_at)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Code incorrect ou expiré.' });
    }
    await client.query('DELETE FROM otps WHERE contact_members = $1', [normalizedContact]);
    console.log('[verifyOTPRegister] ✅ OTP validé et supprimé.');

    // 2️⃣ Vérifie si ce contact existe déjà dans members (doit être unique)
    const memberByContact = await client.query(
      `SELECT id FROM members WHERE contact = $1`,
      [normalizedContact]
    );
    console.log('[verifyOTPRegister] memberByContact:', memberByContact.rows);

    if (memberByContact.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Ce contact est déjà membre Cash Hay.' });
    }

    // 3️⃣ Vérifie si user_id existe déjà dans members
    const memberByUserId = await client.query(
      `SELECT id, contact FROM members WHERE user_id = $1`,
      [userId]
    );
    console.log('[verifyOTPRegister] memberByUserId:', memberByUserId.rows);

    if (memberByUserId.rows.length > 0) {
      const memberId = memberByUserId.rows[0].id;
      // S'il n'a pas encore de contact, on le met à jour !
      if (!memberByUserId.rows[0].contact) {
        await client.query(
          `UPDATE members SET contact = $1, updated_at = $2 WHERE id = $3`,
          [normalizedContact, new Date(), memberId]
        );
        // MAJ users <---- ICI
        await client.query(
          `UPDATE users SET member_id = $1 WHERE id = $2`,
          [memberId, userId]
        );
        await client.query('COMMIT');
        return res.status(200).json({ message: 'Contact ajouté à votre profil membre.', memberId });
      } else {
        await client.query('COMMIT');
        return res.status(200).json({ message: 'Vous êtes déjà membre Cash Hay.', memberId });
      }
    }

    // 4️⃣ INSERT si aucun member trouvé pour ce user_id et ce contact
    const memberId = uuidv4();
    const username = normalizedContact.replace(/[@.+-]/g, '_').slice(0, 30);

    await client.query(
      `INSERT INTO members (id, user_id, display_name, contact, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [memberId, userId, username, normalizedContact, new Date(), new Date()]
    );
    // MAJ users <---- ICI
    await client.query(
      `UPDATE users SET member_id = $1 WHERE id = $2`,
      [memberId, userId]
    );

    await client.query('COMMIT');
    return res.status(200).json({ message: 'Membre créé avec succès.', memberId });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur verifyOTPRegister :', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
};




// ✅ checkMember doit bien renvoyer aussi memberId si existant
export const checkMember = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Token utilisateur manquant.' });

    const userRes = await pool.query('SELECT member_id FROM users WHERE id = $1', [userId]);
    if (userRes.rowCount === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }
    const memberId = userRes.rows[0]?.member_id;

    let exists = false;
if (memberId) {
  const memberRes = await pool.query('SELECT 1 FROM members WHERE id = $1', [memberId]);
  exists = Boolean(memberRes && typeof memberRes.rowCount === 'number' && memberRes.rowCount > 0);
}


    return res.status(200).json({ exists, memberId: memberId ?? null });
  } catch (error) {
    console.error('❌ Erreur checkMember :', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

export const savePushToken = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { pushToken } = req.body;
  if (!pushToken) return res.status(400).json({ error: 'Token manquant.' });
  await pool.query('UPDATE users SET expo_push_token = $1 WHERE id = $2', [pushToken, userId]);
  res.json({ success: true });
};


export const logAudit = async (userId: string, action: string, details = '', req?: Request) => {
  const auditId = uuidv4();
  const ip = req?.ip || '';
  const ua = req?.headers['user-agent'] || '';
  await pool.query(
    `INSERT INTO audit_logs (id, user_id, action, details, ip_address, user_agent, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [auditId, userId, action, details, ip, ua]
  );
};

export const requestNameChange = async (req: Request, res: Response) => {
  try {
    // Authentification (middleware JWT doit setter req.user)
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Non autorisé.' });

    // Vérifie la présence des fichiers
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const justiceDoc = files['justice_document']?.[0];
    const newIdentity = files['new_identity']?.[0];

    if (!justiceDoc || !newIdentity)
      return res.status(400).json({ error: 'Tous les documents sont requis.' });

    // Upload sur Cloudinary
    const uploadToCloudinary = (fileBuffer: Buffer, filename: string) =>
      new Promise<any>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: 'cash-hay/name-change',
            public_id: filename,
            resource_type: 'auto',
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );
        streamifier.createReadStream(fileBuffer).pipe(stream);
      });

    // Upload les deux fichiers
    const [justiceResult, identityResult] = await Promise.all([
      uploadToCloudinary(justiceDoc.buffer, `justice_${userId}_${Date.now()}`),
      uploadToCloudinary(newIdentity.buffer, `identity_${userId}_${Date.now()}`),
    ]);

    const comment = req.body.comment || '';

    // Stocke la demande dans la DB
    await pool.query(
      `INSERT INTO name_change_requests
      (user_id, justice_doc_url, identity_doc_url, comment)
      VALUES ($1, $2, $3, $4)`,
      [
        userId,
        justiceResult.secure_url,
        identityResult.secure_url,
        comment,
      ]
    );

    res.json({ success: true, message: 'Demande envoyée. Un agent va vérifier vos documents.' });
  } catch (err) {
    console.error('Erreur name change:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

export const getSecurityInfo = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Utilisateur non authentifié' });
  }

  try {
    // User infos
    const userRes = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);
    const sec = await pool.query('SELECT sign_in_option, verification_method, biometrics_enabled FROM user_security_options WHERE user_id = $1', [userId]);
    const linked = await pool.query('SELECT id, name, provider, icon_url FROM linked_apps WHERE user_id = $1', [userId]);
    
    // Prend les 4 premiers caractères du username
    const username = userRes.rows[0]?.username ?? '';
    const maskedUsername = username.substring(0, 4).padEnd(username.length, '*');

    res.json({
      username: maskedUsername,
      signInOption: sec.rows[0]?.sign_in_option ?? '',
      verificationMethod: sec.rows[0]?.verification_method ?? '',
      biometricsEnabled: !!sec.rows[0]?.biometrics_enabled, // true/false
      linkedApps: linked.rows.map(app => ({
        id: app.id,
        name: app.name,
        provider: app.provider,
        iconUrl: app.icon_url,
      }))
    });
  } catch (err) {
    console.error('Erreur getSecurityInfo:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

export const changeUsername = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { newUsername, password } = req.body;
  if (!userId || !newUsername || !password) return res.status(400).json({ error: 'Champs requis.' });

  // si tu veux garder la règle forte (différente du usernameRegex global), OK
  const strongUserRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
  if (!strongUserRegex.test(newUsername)) {
    return res.status(400).json({ error: "Username doit avoir min 8 caractères, 1 majuscule, 1 chiffre, 1 symbole." });
  }

  try {
    const userRes = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    if (!userRes.rowCount) return res.status(404).json({ error: 'Utilisateur non trouvé.' });

    const isValid = await bcrypt.compare(password, userRes.rows[0].password_hash);
    if (!isValid) return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });

    const exists = await pool.query('SELECT 1 FROM users WHERE username = $1', [newUsername]);
    if (exists.rowCount) return res.status(409).json({ error: 'Username déjà utilisé.' });

    await pool.query('UPDATE users SET username = $1 WHERE id = $2', [newUsername, userId]);
    res.json({ success: true, message: 'Username modifié avec succès.' });
  } catch (err) {
    console.error('Erreur changeUsername:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};


export const changePassword = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { currentPassword, newPassword } = req.body;

  if (!userId || !currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Champs requis.' });
  }

  const pwdRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
  if (!pwdRegex.test(newPassword)) {
    return res.status(400).json({
      error: "Le mot de passe doit contenir au moins 8 caractères, une majuscule, un chiffre et un symbole.",
    });
  }

  try {
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé.' });

    const isValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValid) return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashed, userId]);

    return res.json({ success: true, message: 'Mot de passe modifié avec succès.' });
  } catch (err) {
    console.error('Erreur changePassword:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};


