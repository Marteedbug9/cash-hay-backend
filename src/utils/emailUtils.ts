import db from '../config/db';
import { sendEmail, sendSMS } from './notificationUtils';


export const maskEmail = (email: string): string => {
  const [user, domain] = email.split('@');
  const maskedUser = user.slice(0, 2) + '***';
  return `${maskedUser}@${domain}`;
};

export const sendSecurityAlertEmail = async (to: string): Promise<void> => {
  const content = `Une tentative de récupération de votre compte a été détectée.`;
  await sendEmail({
    to,
    subject: 'Alerte Sécurité',
    text: content,
  });
};

export const sendOTP = async (phone: string, email: string, otp: string): Promise<void> => {
  await sendEmail({
    to: email,
    subject: 'Votre code de réinitialisation',
    text: `Code: ${otp}`,
  });
  await sendSMS(phone, `Votre code est : ${otp}`);
};

export const storeOTP = async (userId: string, otp: string): Promise<void> => {
  await db.query(
    'INSERT INTO otps (user_id, code, created_at) VALUES ($1, $2, NOW())',
    [userId, otp]
  );
};
