import pool from '../config/db';
import { sendEmail, sendSMS } from './notificationUtils';


// Génère un OTP à 6 chiffres
export const generateOTP = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Envoie un OTP par email et SMS, puis le stocke
export const sendOTP = async (userId: string, phone: string, email: string): Promise<void> => {
  const otp = generateOTP();

  await sendEmail({
    to: email,
    subject: 'Code de vérification Cash Hay',
    text: `Votre code de vérification est : ${otp}`,
  });

  await sendSMS(phone, `Votre code de vérification Cash Hay est : ${otp}`);
  console.log(`✅ OTP "${otp}" envoyé à ${phone} (SMS) et ${email} (email) pour user ${userId}`);
  await storeOTP(userId, otp);
};

// Stocke l'OTP avec date d'expiration (10 minutes)
export const storeOTP = async (userId: string, otp: string): Promise<void> => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60000); // 10 min

  await pool.query(
    'INSERT INTO otps (user_id, code, created_at, expires_at) VALUES ($1, $2, $3, $4)',
    [userId, otp, now, expiresAt]
  );
};

// Vérifie l'OTP (valide et pas expiré)
export const verifyOTP = async (
  userId: string,
  inputCode: string
): Promise<{ valid: boolean; reason?: string }> => {
  const result = await pool.query(
    'SELECT code, expires_at FROM otps WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [userId]
  );

  if (result.rows.length === 0) return { valid: false, reason: 'Aucun code trouvé' };

  const { code, expires_at } = result.rows[0];
  const now = new Date();

  if (now > new Date(expires_at)) return { valid: false, reason: 'Code expiré' };
  if (code !== inputCode) return { valid: false, reason: 'Code invalide' };

  await pool.query('DELETE FROM otps WHERE user_id = $1', [userId]);

  return { valid: true };
};

