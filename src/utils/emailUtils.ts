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
  try {
    await sendEmail({
      to: email,
      subject: 'Votre code de réinitialisation',
      text: `Code: ${otp}`,
    });

    await sendSMS(phone, `Votre code est : ${otp}`);
  } catch (error) {
    console.error('Erreur lors de l’envoi OTP :', error);
    throw new Error('Échec de l’envoi du code OTP.');
  }
};


export const storeOTP = async (userId: string, otp: string): Promise<void> => {
  await db.query('DELETE FROM otps WHERE user_id = $1', [userId]);

  
};

export const verifyOTP = async (userId: string, code: string): Promise<boolean> => {
  const result = await db.query(
    'SELECT * FROM otps WHERE user_id = $1 AND code = $2 AND expires_at > NOW()',
    [userId, code]
  );

  return result.rows.length > 0;
};
