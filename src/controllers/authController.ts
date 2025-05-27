import { RequestHandler, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import pool from '../config/db';
import { sendEmail, sendSMS } from '../utils/notificationUtils';
import { v4 as uuidv4 } from 'uuid';
import cloudinary from '../config/cloudinary';
import { AuthRequest } from '../middlewares/authMiddleware'; // ou src/types







// ➤ Enregistrement
export const register: RequestHandler = async (req, res) => {
  console.log('🟡 Données reçues:', req.body);

  const {
    first_name, last_name, gender, address, city, department, zip_code = '', country,
    email, phone,
    birth_date, birth_country, birth_place,
    id_type, id_number, id_issue_date, id_expiry_date,
    username, password,
    accept_terms
  } = req.body;

  // 🛑 Validation côté serveur
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

    const result = await pool.query(
      `INSERT INTO users (
        id, first_name, last_name, gender, address, city, department, zip_code, country,
        email, phone,
        birth_date, birth_country, birth_place,
        id_type, id_number, id_issue_date, id_expiry_date,
        username, password_hash, role, accept_terms
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11,
        $12, $13, $14,
        $15, $16, $17, $18,
        $19, $20, 'user', $21
      ) RETURNING id, email, first_name, last_name, username`,
      [
        userId, first_name, last_name, gender, address, city, department, zip_code, country,
        email, phone,
        birth_date, birth_country, birth_place,
        id_type, id_number, id_issue_date, id_expiry_date,
        username, hashedPassword, true
      ]
    );

    res.status(201).json({ user: result.rows[0] });
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Email ou nom d’utilisateur déjà utilisé.' });
    }

    console.error('❌ Erreur SQL :', err.message);
    console.error('📄 Détail complet :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};


// ➤ Connexion
export const login: RequestHandler = async (req, res) => {
  console.log('🟡 Requête login reçue avec :', req.body);
  const { username, password } = req.body;

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

    if (user.is_blacklisted) {
      return res.status(403).json({ error: 'Ce compte est sur liste noire.' });
    }

    if (user.is_deceased) {
      return res.status(403).json({ error: 'Ce compte est marqué comme décédé.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role || 'user' },
      process.env.JWT_SECRET || 'devsecretkey',
      { expiresIn: '1h' }
    );

    res.status(200).json({
      message: 'Connexion réussie',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: `${user.first_name} ${user.last_name}`,
        is_verified: user.is_verified || false,
        role: user.role || 'user',
      }
    });
  } catch (error: any) {
    console.error('❌ Erreur dans login:', error.message);
    console.error('🔎 Stack trace:', error.stack);
     console.error('📄 Détail complet :', error);
    
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ➤ Récupération de profil
export const getProfile = async (req: AuthRequest, res: Response) => {
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
export const startRecovery: RequestHandler = async (req, res) => {
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
export const verifyEmailForRecovery: RequestHandler = async (req, res) => {
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
export const resetPassword: RequestHandler = async (req, res) => {
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
    const userId = (req as any).user?.id; // Tu peux typer proprement avec AuthRequest si tu veux

    const files = req.files as {
      [fieldname: string]: import('multer').File[];
    };

    const faceFile = files?.face?.[0];
    const documentFile = files?.document?.[0];

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
      uploadToCloudinary(documentFile.buffer, 'cash-hay/identities/document')
    ]);

    await pool.query('UPDATE users SET is_verified = true WHERE id = $1', [userId]);

    return res.status(200).json({
      message: 'Vérification complétée. Compte activé.',
      faceUrl,
      documentUrl
    });
  } catch (error) {
    console.error('❌ Erreur upload identité:', error);
    res.status(500).json({ error: 'Erreur lors de l’envoi des fichiers.' });
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

export const confirmSuspiciousAttempt: RequestHandler = async (req, res) => {
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
