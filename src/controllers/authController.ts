import { RequestHandler, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import pool from '../config/db';
import { sendEmail, sendSMS } from '../utils/notificationUtils';
import { v4 as uuidv4 } from 'uuid';
import cloudinary from '../config/cloudinary';
import requestIp from 'request-ip';
import { File } from 'multer'; // ✅ ajoute ceci
import db from '../config/db';
import streamifier from 'streamifier';



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

  // ✅ Vérification des champs requis
  if (!first_name || !last_name || !gender || !address || !city || !department || !country ||
    !email || !phone ||
    !birth_date || !birth_country || !birth_place ||
    !id_type || !id_number || !id_issue_date || !id_expiry_date ||
    !username || !password || accept_terms !== true) {
    return res.status(400).json({ error: 'Tous les champs sont requis.' });
  }

  try {
    const userId = uuidv4();
    const hashedPassword = await bcrypt.hash(password, 10);
    const recoveryCode = uuidv4();

    const result = await pool.query(
      `INSERT INTO users (
        id, first_name, last_name, gender, address, city, department, zip_code, country,
        email, phone,
        birth_date, birth_country, birth_place,
        id_type, id_number, id_issue_date, id_expiry_date,
        username, password_hash, role, accept_terms, recovery_code
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11,
        $12, $13, $14,
        $15, $16, $17, $18,
        $19, $20, $21, $22, $23
      ) RETURNING id, email, first_name, last_name, username`,
      [
        userId, first_name, last_name, gender, address, city, department, zip_code, country,
        email, phone,
        birth_date, birth_country, birth_place,
        id_type, id_number, id_issue_date, id_expiry_date,
        username, hashedPassword, 'user', true, recoveryCode
      ]
    );

    // ✅ Création du solde initial à 0
    await pool.query(
      'INSERT INTO balances (user_id, amount) VALUES ($1, $2)',
      [userId, 0]
    );

    // ✅ Envoi Email
    await sendEmail({
      to: email,
      subject: 'Bienvenue sur Cash Hay',
      text: `Bonjour ${first_name},\n\nBienvenue sur Cash Hay ! Votre compte a été créé avec succès. Veuillez compléter la vérification d'identité pour l'activation.\n\nL'équipe Cash Hay.`
    });

    // ✅ Envoi SMS
    await sendSMS(
      phone,
      `Bienvenue ${first_name} ! Votre compte Cash Hay est créé. Complétez votre vérification d'identité pour l'activer.`
    );

    return res.status(201).json({ user: result.rows[0] });

  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Email ou nom d’utilisateur déjà utilisé.' });
    }

    console.error('❌ Erreur SQL :', err.message);
    console.error('📄 Détail complet :', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
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

    
    // 🔍 Vérifie si l'IP a déjà été utilisée
    const ipResult = await pool.query(
      'SELECT * FROM login_history WHERE user_id = $1 AND ip_address = $2',
      [user.id, ip]
    );

    const isNewIP = ipResult.rowCount === 0;

    // ✅ Génère OTP seulement si IP nouvelle OU is_otp_verified = false
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
      // ✅ Enregistre l'IP si déjà vérifié et connue
      await pool.query(
        'INSERT INTO login_history (user_id, ip_address) VALUES ($1, $2)',
        [user.id, ip]
      );
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role || 'user' },
      process.env.JWT_SECRET || 'devsecretkey',
      { expiresIn: '1h' }
    );

    res.status(200).json({
  message: 'Connexion réussie',
  requiresOTP,
  token,
  user: {
    id: user.id,
    username: user.username,
    email: user.email,
    phone: user.phone, // facultatif
    full_name: `${user.first_name} ${user.last_name}`,
    is_verified: user.is_verified || false,
    verified_at: user.verified_at || null, // ✅ ajoute ceci
    identity_verified: user.identity_verified || false, // 👈 ici
    is_otp_verified: user.is_otp_verified || false, // 🔥 important
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
    const result = await pool.query(
      'SELECT id, first_name, last_name, username, email FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé.' });
    }

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('❌ Erreur profil:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ➤ Démarrer récupération de compte
export const startRecovery: RequestHandler = async (req: Request, res: Response)  => {
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

    const maskedEmail = user.email.slice(0, 4) + '***@***';
    res.json({ message: 'Email masqué envoyé.', maskedEmail, userId: user.id });
  } catch (err) {
    console.error(err);
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
export const resetPassword: RequestHandler = async (req: Request, res: Response)  => {
  const { userId, otp, newPassword } = req.body;

  try {
    const result = await pool.query('SELECT recovery_code FROM users WHERE id = $1', [userId]);
    const user = result.rows[0];

    if (!user || user.recovery_code !== otp) {
      return res.status(401).json({ error: 'Code OTP invalide.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password_hash = $1, recovery_code = NULL WHERE id = $2',
      [hashedPassword, userId]
    );

    res.json({ message: 'Mot de passe réinitialisé avec succès.' });
  } catch (err) {
    console.error(err);
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

export const resendOTP: RequestHandler = async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'ID utilisateur requis.' });
  }

  try {
    const userRes = await pool.query(
      'SELECT email, phone FROM users WHERE id = $1',
      [userId]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé.' });
    }

    const user = userRes.rows[0];

    // Vérifie les tentatives dans les 15 dernières minutes
    const since = new Date(Date.now() - 15 * 60 * 1000);
    const attemptsRes = await pool.query(
      `SELECT COUNT(*) FROM otps 
       WHERE user_id = $1 AND created_at > $2`,
      [userId, since]
    );

    const attempts = parseInt(attemptsRes.rows[0].count);

    if (attempts >= 3) {
      // Bloque temporairement 30 minutes dans une table de blocage (ou attribut user)
      await pool.query(
        `INSERT INTO otp_blocks (user_id, blocked_until) 
         VALUES ($1, $2) 
         ON CONFLICT (user_id) DO UPDATE SET blocked_until = $2`,
        [userId, new Date(Date.now() + 30 * 60 * 1000)]
      );

      // Envoyer email et SMS d'alerte
      await sendEmail({
        to: user.email,
        subject: 'Tentatives excessives de vérification - Cash Hay',
        text: `Nous avons détecté plus de 3 tentatives de code en 15 minutes. Si ce n'était pas vous, cliquez ici pour signaler : Y/N. Votre compte est temporairement bloqué 30 minutes.`,
      });

      await sendSMS(user.phone, `Cash Hay : Trop de tentatives OTP. Votre compte est bloqué 30 min. Répondez Y ou N pour valider.`);

      return res.status(429).json({
        error: 'Trop de tentatives. Votre compte est bloqué 30 minutes. Contactez le support si besoin.'
      });
    }

    // Vérifie si le compte est bloqué
    const blockCheck = await pool.query(
      `SELECT blocked_until FROM otp_blocks WHERE user_id = $1`,
      [userId]
    );

    if (blockCheck.rows.length > 0) {
      const blockedUntil = new Date(blockCheck.rows[0].blocked_until);
      if (blockedUntil > new Date()) {
        return res.status(403).json({
          error: `Ce compte est temporairement bloqué jusqu'à ${blockedUntil.toLocaleTimeString()}`
        });
      }
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60000); // 10 minutes

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

    res.status(200).json({ message: 'Code renvoyé avec succès.' });
  } catch (err) {
    console.error('Erreur lors du renvoi OTP:', err);
    res.status(500).json({ error: 'Erreur serveur lors du renvoi du code.' });
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

export const verifyOTP: RequestHandler = async (req: Request, res: Response)  => {
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
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'devsecretkey',
      { expiresIn: '24h' }
    );

    console.log('✅ Code OTP validé avec succès');

    return res.status(200).json({
  token,
  user: {
    id: user.id,
    username: user.username,
    email: user.email,
    phone: user.phone,
    full_name: `${user.first_name} ${user.last_name}`,
    is_verified: user.is_verified,
    is_otp_verified: true,
    identity_verified: user.identity_verified,
    identity_request_enabled: user.identity_request_enabled, 
    role: user.role,
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

    const uploadFromBuffer = (fileBuffer: Buffer): Promise<any> => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: 'cash-hay/profiles',
            public_id: `profile_${userId}`,
            resource_type: 'image',
            format: 'jpg',
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

    await pool.query('UPDATE users SET profile_image = $1 WHERE id = $2', [
      result.secure_url,
      userId,
    ]);

    res.status(200).json({ imageUrl: result.secure_url });
  } catch (err) {
    console.error('❌ Erreur upload image :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// 🔍 Recherche d'utilisateur par email ou téléphone
export const searchUserByContact = async (req: Request, res: Response) => {
  const contact = req.query.contact as string;
  if (!contact) {
    return res.status(400).json({ error: 'Contact manquant ou invalide' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT id, full_name, profile_image AS photo_url FROM users WHERE email = $1 OR phone = $1',
      [contact]
    );

    if (rows.length === 0) {
      return res.status(404).json({ exists: false });
    }

    return res.json({ exists: true, user: rows[0] });
  } catch (err) {
    console.error('❌ Erreur recherche utilisateur :', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};