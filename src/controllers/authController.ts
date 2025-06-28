import { RequestHandler, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { generateOTP } from '../utils/otpUtils';
import bcrypt from 'bcrypt';
import pool from '../config/db';
import { sendEmail, sendSMS } from '../utils/notificationUtils';
import { v4 as uuidv4 } from 'uuid';
import cloudinary from '../config/cloudinary';
import requestIp from 'request-ip';
import { File } from 'multer'; // ✅ ajoute ceci
import db from '../config/db';
import streamifier from 'streamifier';

function generateCardNumber(): string {
  // Génère un numéro fictif style Visa, à remplacer si tu as une vraie logique
  return '5094' + Math.floor(100000000000 + Math.random() * 900000000000).toString();
}

function generateExpiryDate(): string {
  const now = new Date();
  const year = now.getFullYear() + 4;
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  return `${month}/${year.toString().slice(-2)}`; // '06/29'
}

function generateCVV(): string {
  return Math.floor(100 + Math.random() * 900).toString();
}


// ➤ Enregistrement
export const register = async (req: Request, res: Response) => {
  console.log('🟡 Données reçues:', req.body);

  const {
    first_name, last_name, gender, address, city, department, zip_code = '', country,
    email, phone,
    birth_date, birth_country, birth_place,
    id_type, id_number, id_issue_date, id_expiry_date,
    username, password,
    accept_terms
  } = req.body;

  const usernameRegex = /^[a-zA-Z0-9@#%&._-]{3,30}$/;
  if (!username || !usernameRegex.test(username)) {
    return res.status(400).json({
      error: "Nom d’utilisateur invalide. Seuls les caractères alphanumériques et @ # % & . _ - sont autorisés (3-30 caractères)."
    });
  }
  // Vérif champs requis...
  if (!first_name || !last_name || !gender || !address || !city || !department || !country ||
    !email || !phone ||
    !birth_date || !birth_country || !birth_place ||
    !id_type || !id_number || !id_issue_date || !id_expiry_date ||
    !username || !password || accept_terms !== true) {
    return res.status(400).json({ error: 'Tous les champs sont requis.' });
  }

  // Démarre la transaction pour tout insérer d’un coup (atomicité)
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userId = uuidv4();
    const memberId = uuidv4();
    const cardId = uuidv4();
    const hashedPassword = await bcrypt.hash(password, 10);
    const recoveryCode = uuidv4();

    // 1. USERS
    await client.query(
  `INSERT INTO users (
    id, first_name, last_name, gender, address, city, department, zip_code, country,
    email, phone, birth_date, birth_country, birth_place,
    id_type, id_number, id_issue_date, id_expiry_date,
    username, password_hash, role, accept_terms, recovery_code
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9,
    $10, $11, $12, $13, $14,
    $15, $16, $17, $18,
    $19, $20, $21, $22, $23
  )`,
  [
    userId, first_name, last_name, gender, address, city, department, zip_code, country,
    email, phone, birth_date, birth_country, birth_place,
    id_type, id_number, id_issue_date, id_expiry_date,
    username, hashedPassword, 'user', true, recoveryCode
  ]
);

    // Après la création du nouvel utilisateur (userId)...
   
   
await client.query(
  `INSERT INTO cards (
      id, user_id, card_number, expiry_date, cvv, type, account_type, status, created_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, NOW()
    )`,
  [
    cardId,
    userId,
    generateCardNumber(),      // À toi d’implémenter une fonction de génération !
    generateExpiryDate(),      // Ex: '08/29'
    generateCVV(),             // Ex: '934'
    'virtual',
    'checking',
    'pending'                  // ou 'active' si validé direct
  ]
);


    // 2. BALANCES
    await client.query(
      'INSERT INTO balances (user_id, amount) VALUES ($1, $2)',
      [userId, 0]
    );

    // 3. MEMBERS (on met bien l'user_id et le contact unique)
    await client.query(
  `INSERT INTO members (id, user_id, display_name, created_at, updated_at)
   VALUES ($1, $2, $3, NOW(), NOW())`,
  [memberId, userId, username]
);

    // 4. LOGIN_HISTORY (optionnel mais recommandé)
    await client.query(
      'INSERT INTO login_history (user_id, ip_address, created_at) VALUES ($1, $2, NOW())',
      [userId, req.ip]
    );

    // 5. Notifications initiales, audit_logs, etc. (optionnel selon besoin)

    await client.query('COMMIT');

    // Envois email et sms (en dehors de la transaction, car pas critique)
    await sendEmail({
      to: email,
      subject: 'Bienvenue sur Cash Hay',
      text: `Bonjour ${first_name},\n\nBienvenue sur Cash Hay ! Votre compte a été créé avec succès. Veuillez compléter la vérification d'identité pour l'activation.\n\nL'équipe Cash Hay.`
    });
    await sendSMS(
      phone,
      `Bienvenue ${first_name} ! Votre compte Cash Hay est créé. Complétez votre vérification d'identité pour l'activer.`
    );

    return res.status(201).json({
      user: {
        id: userId, email, first_name, last_name, username
      }
    });

  } catch (err: any) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Email ou nom d’utilisateur déjà utilisé.' });
    }
    console.error('❌ Erreur SQL :', err.message);
    console.error('📄 Détail complet :', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  } finally {
    client.release();
  }
};


// ➤ Connexion
export const login = async (req: Request, res: Response) => {
  console.log('🟡 Requête login reçue avec :', req.body);
  const { username, password } = req.body;
  const ip = requestIp.getClientIp(req);

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Nom d’utilisateur ou mot de passe incorrect.' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Nom d’utilisateur ou mot de passe incorrect.' });
    }

    if (user.is_deceased) {
      return res.status(403).json({ error: 'Ce compte est marqué comme décédé.' });
    }

    if (user.is_blacklisted) {
      return res.status(403).json({ error: 'Ce compte est sur liste noire.' });
    }

    const ipResult = await pool.query(
      'SELECT * FROM login_history WHERE user_id = $1 AND ip_address = $2',
      [user.id, ip]
    );
    const isNewIP = ipResult.rowCount === 0;

    const requiresOTP = !user.is_otp_verified || isNewIP;

    if (requiresOTP) {
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      await pool.query('DELETE FROM otps WHERE user_id = $1', [user.id]);

      const otpInsert = await pool.query(
        `INSERT INTO otps (user_id, code, created_at, expires_at)
         VALUES ($1, $2, NOW(), NOW() + INTERVAL '10 minutes')`,
        [user.id, code]
      );
      console.log('✅ OTP enregistré:', otpInsert.rowCount);
      console.log(`📩 Code OTP pour ${user.username} : ${code}`);
    } else {
      await pool.query(
        'INSERT INTO login_history (user_id, ip_address) VALUES ($1, $2)',
        [user.id, ip]
      );
    }

    const token = jwt.sign(
  {
    id: user.id,
    email: user.email,
    role: user.role || 'user',
    is_otp_verified: user.is_otp_verified || false, // ← ajoute ceci
  },
  process.env.JWT_SECRET || 'devsecretkey',
  { expiresIn: '1h' }
);


    // Fonction pour masquer le username
    const maskUsername = (name: string): string => {
      if (name.length <= 4) return name;
      const visible = name.slice(0, 4);
      const masked = '*'.repeat(name.length - 4);
      return visible + masked;
    };

    res.status(200).json({
      message: 'Connexion réussie',
      requiresOTP,
      token,
      user: {
        id: user.id,
        username: maskUsername(user.username), // ← ici le username masqué
        email: user.email,
        phone: user.phone,
        first_name: user.first_name,
        last_name: user.last_name,
        photo_url: user.photo_url || null,
        is_verified: user.is_verified || false,
        verified_at: user.verified_at || null,
        identity_verified: user.identity_verified || false,
        is_otp_verified: user.is_otp_verified || false,
        role: user.role || 'user',
      }
    });

  } catch (error: any) {
    console.error('❌ Erreur dans login:', error.message);
    console.error('🔎 Stack trace:', error.stack);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};


// ➤ Récupération de profil
export const getProfile = async (req: Request, res: Response) => { 
  const userId = req.user?.id;

  try {
    // Utilise les colonnes qui existent vraiment
    const result = await pool.query(
      `SELECT 
          u.id,
          u.username,
          u.email,
          u.first_name,
          u.last_name,
          u.phone,
          u.address,
          m.contact
        FROM users u
        LEFT JOIN members m ON m.user_id = u.id
        WHERE u.id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé.' });
    }

    const row = result.rows[0];
    const fullName = [row.first_name, row.last_name].filter(Boolean).join(' ');

    res.json({
      user: {
        id: row.id,
        username: row.username,
        email: row.email,
        full_name: fullName,
        first_name: row.first_name || '',   // <= AJOUTE
        last_name: row.last_name || '', 
        address: row.address || '',
        phone: row.phone || '',
        contact: row.contact || '',
      },
    });
  } catch (err) {
    console.error('❌ Erreur profil:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};





// ➤ Démarrer récupération de compte
export const startRecovery: RequestHandler = async (req: Request, res: Response) => {
  const { credentialType, value } = req.body;

  try {
    let user;
    if (credentialType === 'username') {
      const result = await pool.query('SELECT id, email FROM users WHERE username = $1', [value]);
      user = result.rows[0];
    } else {
      const result = await pool.query('SELECT id, email FROM users WHERE email = $1', [value]);
      user = result.rows[0];
    }

    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé.' });

    // 🔒 Insertion dans logs_security
    await pool.query(
      `INSERT INTO logs_security (user_id, action, ip_address, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [user.id, 'start_recovery', req.ip]
    );

    const maskedEmail = user.email.slice(0, 4) + '***@***';
    res.json({ message: 'Email masqué envoyé.', maskedEmail, userId: user.id });
  } catch (err) {
    console.error('❌ Erreur startRecovery:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};


// ➤ Envoi OTP pour récupération
export const verifyEmailForRecovery: RequestHandler = async (req: Request, res: Response)  => {
  const { userId, verifiedEmail } = req.body;

  try {
    const result = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
    const user = result.rows[0];

    if (!user || user.email !== verifiedEmail) {
      return res.status(401).json({ error: 'Adresse email non valide.' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await pool.query('UPDATE users SET recovery_code = $1 WHERE id = $2', [otp, userId]);

    await sendEmail({
      to: user.email,
      subject: 'Code OTP - Cash Hay',
      text: `Votre code est : ${otp}`
    });

    await sendSMS(user.email, `Cash Hay : Votre code OTP est : ${otp}`);

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

     const files = req.files as {
     [fieldname: string]: File[];
};


    const faceFile = files?.face?.[0];
    const documentFile = files?.document?.[0];




    if (!faceFile || !documentFile) {
      return res.status(400).json({ error: 'Photos manquantes (visage ou pièce).' });
    }

    // Fonction d'upload vers Cloudinary
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
      uploadToCloudinary(documentFile.buffer, 'cash-hay/identities/document')
    ]);

    // 🔒 Mise à jour utilisateur (attente d'approbation admin)
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

    // 🧾 Journalisation
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        userId,
        'upload_identity',
        `Vérification identité : photo visage et pièce soumises.`,
        ip?.toString(),
        userAgent || 'N/A'
      ]
    );

    console.log('📥 uploadIdentity exécuté avec succès pour', userId);

    return res.status(200).json({
      message: 'Documents soumis avec succès. En attente de validation.',
      faceUrl,
      documentUrl
    });

  } catch (error) {
    console.error('❌ Erreur upload identité:', error);
    return res.status(500).json({ error: 'Erreur lors de l’envoi des fichiers.' });
  }
};


// ➤ Renvoyer un code OTP

export const resendOTP: RequestHandler = async (req: Request, res: Response) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'ID utilisateur requis.' });
  }

  try {
    const userRes = await pool.query('SELECT email, phone FROM users WHERE id = $1', [userId]);

    if (userRes.rows.length === 0) {
      await pool.query(
        `INSERT INTO logs_security (user_id, action, ip_address, created_at)
         VALUES ($1, 'resend_otp_failed_user_not_found', $2, NOW())`,
        [userId, req.ip]
      );
      await pool.query(
        `INSERT INTO audit_logs (user_id, event_type, ip_address, timestamp)
         VALUES ($1, 'resend_otp_failed_user_not_found', $2, NOW())`,
        [userId, req.ip]
      );
      return res.status(404).json({ error: 'Utilisateur non trouvé.' });
    }

    const user = userRes.rows[0];

    const blockCheck = await pool.query('SELECT blocked_until FROM otp_blocks WHERE user_id = $1', [userId]);
    if (blockCheck.rows.length > 0) {
      const blockedUntil = new Date(blockCheck.rows[0].blocked_until);
      if (blockedUntil > new Date()) {
        await pool.query(
          `INSERT INTO logs_security (user_id, action, ip_address, created_at)
           VALUES ($1, 'resend_otp_blocked', $2, NOW())`,
          [userId, req.ip]
        );
        await pool.query(
          `INSERT INTO audit_logs (user_id, event_type, ip_address, timestamp)
           VALUES ($1, 'resend_otp_blocked', $2, NOW())`,
          [userId, req.ip]
        );
        return res.status(403).json({
          error: `Ce compte est temporairement bloqué jusqu'à ${blockedUntil.toLocaleTimeString()}`,
        });
      }
    }

    const since = new Date(Date.now() - 15 * 60 * 1000);
    const attemptsRes = await pool.query(
      `SELECT COUNT(*) FROM otps WHERE user_id = $1 AND created_at > $2`,
      [userId, since]
    );

    const attempts = parseInt(attemptsRes.rows[0].count);

    if (attempts >= 3) {
      const blockUntil = new Date(Date.now() + 30 * 60 * 1000);
      await pool.query(
        `INSERT INTO otp_blocks (user_id, blocked_until)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET blocked_until = $2`,
        [userId, blockUntil]
      );

      await sendEmail({
        to: user.email,
        subject: 'Tentatives excessives de vérification - Cash Hay',
        text: `Nous avons détecté plus de 3 tentatives de code. Votre compte est temporairement bloqué 30 minutes.`,
      });

      await sendSMS(user.phone, `Cash Hay : Trop de tentatives OTP. Compte bloqué 30 min.`);

      await pool.query(
        `INSERT INTO logs_security (user_id, action, ip_address, created_at)
         VALUES ($1, 'resend_otp_blocked_30min', $2, NOW())`,
        [userId, req.ip]
      );
      await pool.query(
        `INSERT INTO audit_logs (user_id, event_type, ip_address, timestamp)
         VALUES ($1, 'resend_otp_blocked_30min', $2, NOW())`,
        [userId, req.ip]
      );

      return res.status(429).json({
        error: 'Trop de tentatives. Votre compte est bloqué 30 minutes. Contactez le support si besoin.',
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60000);

    await pool.query(
      'INSERT INTO otps (user_id, code, created_at, expires_at) VALUES ($1, $2, $3, $4)',
      [userId, otp, now, expiresAt]
    );

    await sendEmail({
      to: user.email,
      subject: 'Code de vérification - Cash Hay',
      text: `Votre code est : ${otp}`,
    });

    await sendSMS(user.phone, `Cash Hay : Votre code OTP est : ${otp}`);

    await pool.query(
      `INSERT INTO logs_security (user_id, action, ip_address, created_at)
       VALUES ($1, 'resend_otp_success', $2, NOW())`,
      [userId, req.ip]
    );
    await pool.query(
      `INSERT INTO audit_logs (user_id, event_type, ip_address, timestamp)
       VALUES ($1, 'resend_otp_success', $2, NOW())`,
      [userId, req.ip]
    );

    return res.status(200).json({ message: 'Code renvoyé avec succès.' });
  } catch (err) {
    console.error('❌ Erreur lors du renvoi OTP:', err);
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

export const verifyOTP: RequestHandler = async (req: Request, res: Response) => {
  const { userId, code } = req.body;

  if (!userId || !code) {
    return res.status(400).json({ error: 'ID utilisateur et code requis.' });
  }

  try {
    const otpRes = await pool.query(
      'SELECT code, expires_at FROM otps WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [userId]
    );

    if (otpRes.rows.length === 0) {
      console.log('⛔ Aucun code OTP trouvé pour cet utilisateur');
      return res.status(400).json({ valid: false, reason: 'Expired or invalid code.' });
    }

    const { code: storedCode, expires_at } = otpRes.rows[0];
    const now = new Date();

    if (now > new Date(expires_at)) {
      console.log('⏰ Code OTP expiré');
      return res.status(400).json({ valid: false, reason: 'Code expiré.' });
    }

    const receivedCode = String(code).trim();
    const expectedCode = String(storedCode).trim();

    console.log(`📥 Code reçu: "${receivedCode}" (longueur: ${receivedCode.length})`);
    console.log(`📦 Code attendu: "${expectedCode}" (longueur: ${expectedCode.length})`);

    if (receivedCode !== expectedCode) {
      console.log('❌ Code incorrect (comparaison échouée)');
      return res.status(400).json({ error: 'Code invalide.' });
    }

    // ✅ Marquer l’utilisateur comme vérifié
    await pool.query(
      'UPDATE users SET is_otp_verified = true WHERE id = $1',
      [userId]
    );

    // ✅ Supprimer les OTP anciens
    await pool.query('DELETE FROM otps WHERE user_id = $1', [userId]);

    // 🔁 Regénérer le token
    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    const user = userRes.rows[0];
    const token = jwt.sign(
  {
    id: user.id,
    email: user.email,
    role: user.role,
    is_otp_verified: true, // ✅ Ajoute ce champ ici
  },
  process.env.JWT_SECRET || 'devsecretkey',
  { expiresIn: '24h' }
    );

    // ✅ Loguer l’action
    await pool.query(
      `INSERT INTO logs_security (user_id, action, ip_address, created_at)
       VALUES ($1, 'verify_otp', $2, NOW())`,
      [userId, req.ip]
    );

    console.log('✅ Code OTP validé avec succès');

    return res.status(200).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        phone: user.phone,
        first_name: user.first_name,
        last_name: user.last_name,
        photo_url: user.photo_url || null,
        is_verified: user.is_verified || false,
        is_otp_verified: true,
        identity_verified: user.identity_verified || false,
        identity_request_enabled: user.identity_request_enabled ?? true,
        role: user.role || 'user',
      },
    });

  } catch (err: any) {
    console.error('❌ Erreur vérification OTP:', err.message);
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

// 🔍 Recherche d'utilisateur par email ou téléphone
export const searchUserByContact = async (req: Request, res: Response) => {
  const contacts: string[] = req.body.contacts;

  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ error: 'Aucun contact fourni.' });
  }

  try {
    // Nettoyer et unicité
    const uniqueContacts = [...new Set(contacts.map(c => c.trim().toLowerCase()))];

    // On récupère le membre ET on join les infos users
    const query = `
      SELECT 
        m.id AS member_id,
        m.contact,
        m.display_name,
        u.id AS user_id,
        u.email,
        u.phone,
        u.username,
        u.first_name,
        u.last_name,
        (u.first_name || ' ' || u.last_name) AS full_name,
        u.photo_url
      FROM members m
      LEFT JOIN users u ON m.user_id = u.id
      WHERE m.contact = ANY($1)
    `;

    const { rows } = await pool.query(query, [uniqueContacts]);

    return res.status(200).json({ users: rows });
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

  if (!userId || !newUsername || !password) {
    return res.status(400).json({ error: 'Champs requis.' });
  }

  // Critères: 8+ char, 1 Maj, 1 chiffre, 1 symbole
  const usernameRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
  if (!usernameRegex.test(newUsername)) {
    return res.status(400).json({ error: "Username doit avoir min 8 caractères, 1 majuscule, 1 chiffre, 1 symbole." });
  }

  try {
    // Vérifie password actuel
    const userRes = await pool.query('SELECT password FROM users WHERE id = $1', [userId]);
    if (!userRes.rows.length) return res.status(404).json({ error: 'Utilisateur non trouvé.' });

    const isValid = await bcrypt.compare(password, userRes.rows[0].password);
    if (!isValid) return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });

    // Vérifie unicité du username
    const exists = await pool.query('SELECT id FROM users WHERE username = $1', [newUsername]);
    if (exists.rows.length) return res.status(409).json({ error: 'Username déjà utilisé.' });

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


