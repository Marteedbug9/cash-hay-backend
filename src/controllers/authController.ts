import { RequestHandler, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import pool from '../config/db';
import { sendEmail, sendSMS } from '../utils/notificationUtils';
import { v4 as uuidv4 } from 'uuid';
import  cloudinary  from '../config/cloudinary';



interface AuthRequest extends Request {
  user?: any;
}

interface MulterRequest extends Request {
  files?: {
    face?: Express.Multer.File[];
    document?: Express.Multer.File[];
  };
}

// ➤ Enregistrement complet
export const register: RequestHandler = async (req, res) => {
  const {
    first_name, last_name, gender, address, email, phone,
    birth_date, birth_country, birth_place,
    id_type, id_number, id_issue_date, id_expiry_date,
    username, password
  } = req.body;

  if (!first_name || !last_name || !gender || !address || !email || !phone ||
      !birth_date || !birth_country || !birth_place ||
      !id_type || !id_number || !id_issue_date || !id_expiry_date ||
      !username || !password) {
    return res.status(400).json({ error: 'Tous les champs sont requis.' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4(); // ← Génère un ID unique

    const result = await pool.query(
      `INSERT INTO users (
        id, first_name, last_name, gender, address, email, phone,
        birth_date, birth_country, birth_place,
        id_type, id_number, id_issue_date, id_expiry_date,
        username, password_hash
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16
      ) RETURNING id, email, first_name, last_name, username`,
      [
        userId, first_name, last_name, gender, address, email, phone,
        birth_date, birth_country, birth_place,
        id_type, id_number, id_issue_date, id_expiry_date,
        username, hashedPassword
      ]
    );

    res.status(201).json({ user: result.rows[0] });
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Email ou nom d’utilisateur déjà utilisé.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ➤ Connexion avec username
export const login: RequestHandler = async (req, res) => {
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

    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET || 'devsecretkey',
      { expiresIn: '7d' }
    );

    res.status(200).json({
      message: 'Connexion réussie',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: `${user.first_name} ${user.last_name}`
      }
    });
  } catch (error) {
    console.error('❌ Erreur dans login:', error);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ➤ Profil sécurisé
export const getProfile: RequestHandler = async (req: AuthRequest, res: Response) => {
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
    console.error('❌ Erreur lors de la récupération du profil:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ➤ Étape 1 : Démarrer la récupération
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

// ➤ Étape 2 : Vérifier l’email
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

// ➤ Étape 3 : Réinitialiser mot de passe
export const resetPassword: RequestHandler = async (req, res) => {
  const { userId, otp, newPassword } = req.body;

  try {
    const result = await pool.query('SELECT recovery_code FROM users WHERE id = $1', [userId]);
    const user = result.rows[0];

    if (!user || user.recovery_code !== otp) {
      return res.status(401).json({ error: 'Code OTP invalide.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password = $1, recovery_code = NULL WHERE id = $2', [
      hashedPassword, userId
    ]);

    res.json({ message: 'Mot de passe réinitialisé avec succès.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ➤ Étape 4 : Verification identiter

export const uploadIdentity = async (req: MulterRequest, res: Response) => {
  try {
    const faceFile = req.files?.face?.[0];
    const documentFile = req.files?.document?.[0];

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

    return res.status(200).json({ faceUrl, documentUrl });
  } catch (error) {
    console.error('❌ Erreur serveur:', error);
    res.status(500).json({ error: 'Erreur lors de l’envoi des fichiers.' });
  }
};