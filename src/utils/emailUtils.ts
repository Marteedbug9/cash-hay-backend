// src/utils/emailUtils.ts
import db from '../config/db';
import { sendEmail, sendSMS } from './notificationUtils';
import crypto from 'crypto';

export const maskEmail = (email: string): string => {
  const [user, domain] = email.split('@');
  const maskedUser = (user ?? '').slice(0, 2) + '***';
  return `${maskedUser}@${domain ?? ''}`;
};

export const sendSecurityAlertEmail = async (to: string): Promise<void> => {
  const content = `Une tentative de récupération de votre compte a été détectée.`;
  await sendEmail({
    to,
    subject: 'Alerte Sécurité',
    text: content,
  });
};

/**
 * Envoie un OTP par email + SMS.
 */
export const sendOTP = async (phone: string, email: string, otp: string): Promise<void> => {
  const tasks: Promise<any>[] = [];

  if (email) {
    tasks.push(
      sendEmail({
        to: email,
        subject: 'Votre code de réinitialisation',
        text: `Code: ${otp}`,
      }).catch((e: any) => console.error('❌ Email OTP:', e?.message || e))
    );
  }

  if (phone) {
    tasks.push(
      sendSMS(phone, `Votre code est : ${otp}`).catch((e: any) =>
        console.error('❌ SMS OTP:', e?.message || e)
      )
    );
  }

  await Promise.allSettled(tasks);
};

/**
 * Stocke l’OTP de manière sécurisée (hash SHA-256) dans la table otps
 * et applique une limite d’envoi (1 OTP / 30s).
 */
export const storeOTP = async (userId: string, otp: string): Promise<void> => {
  const codeHash = crypto.createHash('sha256').update(otp, 'utf8').digest('hex');

  // Empêche l’envoi excessif : 1 OTP par 30 secondes
  const recent = await db.query(
    `SELECT 1 FROM otps WHERE user_id=$1 AND created_at > NOW() - INTERVAL '30 seconds'`,
    [userId]
  );

  if ((recent?.rowCount ?? 0) > 0) {
    console.warn(`⚠️ OTP déjà envoyé récemment à l'utilisateur ${userId}`);
    return;
  }

  // Nettoyage des anciens OTP expirés
  await db.query(`DELETE FROM otps WHERE expires_at < NOW() - INTERVAL '1 day'`);

  // Insertion / mise à jour
  await db.query(
    `INSERT INTO otps (user_id, code_hash, expires_at, created_at)
     VALUES ($1, $2, NOW() + INTERVAL '10 minutes', NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET code_hash = EXCLUDED.code_hash,
           expires_at = EXCLUDED.expires_at,
           created_at = EXCLUDED.created_at`,
    [userId, codeHash]
  );
};

/**
 * Vérifie l’OTP en comparant le hash et la validité temporelle.
 */
export const verifyOTP = async (userId: string, code: string): Promise<boolean> => {
  const codeHash = crypto.createHash('sha256').update(code, 'utf8').digest('hex');

  const result = await db.query(
    `SELECT 1
       FROM otps
      WHERE user_id = $1
        AND code_hash = $2
        AND expires_at > NOW()
      LIMIT 1`,
    [userId, codeHash]
  );

  return (result?.rowCount ?? 0) > 0;
};
