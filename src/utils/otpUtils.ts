// src/utils/otpUtils.ts
import pool from '../config/db';
import { sendEmail, sendSMS } from './notificationUtils';
import { sha256Hex, timingSafeEqualHex, normalizeOtp } from './security';

// --- Helper pour limiter la durée d’attente d’une promesse ---
const withTimeout = <T,>(promise: Promise<T>, ms: number, label = 'op'): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    promise
      .then(value => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(error => {
        clearTimeout(timer);
        reject(error);
      });
  });

// --- Génère un OTP aléatoire à 6 chiffres ---
export const generateOTP = (): string =>
  Math.floor(100000 + Math.random() * 900000).toString();

// --- Envoie OTP par SMS et Email, puis stocke le hash ---
export const sendOTP = async (
  userId: string,
  phone: string | null,
  email: string | null
): Promise<{ sms: 'sent' | 'skipped' | 'failed'; email: 'sent' | 'skipped' | 'failed' }> => {
  const otp = generateOTP();

  // Prépare les promesses d’envoi (SMS prioritaire)
  const tasks: { sms?: Promise<any>; email?: Promise<any> } = {};

  if (phone && phone.trim()) {
    tasks.sms = withTimeout(
      sendSMS(phone, `Votre code de vérification Cash Hay est : ${otp}`),
      10_000,
      'sms'
    );
  }

  if (email && email.trim()) {
    tasks.email = withTimeout(
      sendEmail({
        to: email,
        subject: 'Code de vérification Cash Hay',
        text: `Votre code de vérification est : ${otp}`,
        html: `<p>Votre code OTP est : <b>${otp}</b></p>`,
      }),
      8_000,
      'email'
    );
  }

  // Exécution parallèle sans bloquer la requête
  const [smsRes, emailRes] = await Promise.allSettled([
    tasks.sms ?? Promise.resolve('skipped'),
    tasks.email ?? Promise.resolve('skipped'),
  ]);

  // Stockage sécurisé dans la base (quoi qu’il arrive)
  await storeOTP(userId, otp);

  // Détermination des statuts
  const smsStatus = smsRes.status === 'fulfilled' ? 'sent' : smsRes.status === 'rejected' ? 'failed' : 'skipped';
  const emailStatus = emailRes.status === 'fulfilled' ? 'sent' : emailRes.status === 'rejected' ? 'failed' : 'skipped';

  if (smsStatus !== 'sent') console.warn(`[OTP] SMS ${smsStatus} pour ${phone ?? 'n/a'}`);
  if (emailStatus !== 'sent') console.warn(`[OTP] Email ${emailStatus} pour ${email ?? 'n/a'}`);

  return { sms: smsStatus, email: emailStatus };
};

// --- Stocke un OTP hashé valable 10 minutes (UPSERT) ---
export const storeOTP = async (userId: string, otp: string): Promise<void> => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes
  const codeHash = sha256Hex(normalizeOtp(otp));

  await pool.query(
    `INSERT INTO otps (user_id, code_hash, created_at, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id)
     DO UPDATE SET code_hash = EXCLUDED.code_hash,
                   created_at = EXCLUDED.created_at,
                   expires_at = EXCLUDED.expires_at`,
    [userId, codeHash, now, expiresAt]
  );
};

// --- Vérifie un OTP (constant-time) ---
export const verifyOTP = async (
  userId: string,
  inputCode: string
): Promise<{ valid: boolean; reason?: string }> => {
  const result = await pool.query(
    `SELECT code_hash, expires_at
       FROM otps
      WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) return { valid: false, reason: 'Aucun code trouvé' };

  const { code_hash, expires_at } = result.rows[0];
  if (new Date() > new Date(expires_at)) return { valid: false, reason: 'Code expiré' };

  const candidate = sha256Hex(normalizeOtp(inputCode));
  const match = timingSafeEqualHex(code_hash, candidate);
  if (!match) return { valid: false, reason: 'Code invalide' };

  // Nettoyage optionnel
  await pool.query('DELETE FROM otps WHERE user_id = $1', [userId]);
  return { valid: true };
};
