// src/utils/otpUtils.ts
import pool from '../config/db';
import { sendEmail, sendSMS } from './notificationUtils';
import { sha256Hex, timingSafeEqualHex, normalizeOtp } from './security';

// Génère un OTP à 6 chiffres (comportement identique à avant)
export const generateOTP = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Envoie un OTP par email et SMS, puis le stocke (hashé)
export const sendOTP = async (userId: string, phone: string, email: string): Promise<void> => {
  const otp = generateOTP();

  // Envoi (on envoie le code en clair au destinataire)
  await sendEmail({
    to: email,
    subject: 'Code de vérification Cash Hay',
    text: `Votre code de vérification est : ${otp}`,
  });

  await sendSMS(phone, `Votre code de vérification Cash Hay est : ${otp}`);

  // Stockage hashé
  await storeOTP(userId, otp);
};

// Stocke l’OTP hashé avec date d’expiration (10 minutes)
export const storeOTP = async (userId: string, otp: string): Promise<void> => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60000); // 10 min

  const codeHash = sha256Hex(normalizeOtp(otp));

  // On insère une nouvelle ligne (comme avant). Si tu préfères un upsert par user_id,
  // mets une contrainte UNIQUE(user_id) et remplace par ON CONFLICT.
  await pool.query(
    `INSERT INTO otps (user_id, code_hash, created_at, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, codeHash, now, expiresAt]
  );
};

// Vérifie l’OTP (valide et pas expiré), comparaison constant-time
export const verifyOTP = async (
  userId: string,
  inputCode: string
): Promise<{ valid: boolean; reason?: string }> => {
  const result = await pool.query(
    `SELECT code_hash, expires_at
       FROM otps
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId]
  );

  if (result.rows.length === 0) return { valid: false, reason: 'Aucun code trouvé' };

  const { code_hash, expires_at } = result.rows[0];
  const now = new Date();
  if (now > new Date(expires_at)) return { valid: false, reason: 'Code expiré' };

  const candidate = sha256Hex(normalizeOtp(inputCode));
  const ok = timingSafeEqualHex(code_hash, candidate);
  if (!ok) return { valid: false, reason: 'Code invalide' };

  // Nettoyage best-effort
  await pool.query('DELETE FROM otps WHERE user_id = $1', [userId]);

  return { valid: true };
};
