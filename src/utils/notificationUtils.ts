import nodemailer from 'nodemailer';
import twilio from 'twilio';
import dotenv from 'dotenv';

dotenv.config();

// --- Init Twilio ---
const twilioClient = twilio(
  process.env.TWILIO_SID!,
  process.env.TWILIO_TOKEN!
);

// --- ENVOI EMAIL ---
export const sendEmail = async ({
  to,
  subject,
  text,
}: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> => {
  const { EMAIL_USER, EMAIL_PASS } = process.env;

  if (!EMAIL_USER || !EMAIL_PASS) {
    throw new Error('EMAIL_USER ou EMAIL_PASS manquant dans .env');
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS,
    },
  });

  try {
    await transporter.sendMail({
      from: `"Cash Hay" <${EMAIL_USER}>`,
      to,
      subject,
      text,
    });
    console.log(`📨 Email envoyé à ${to}`);
  } catch (error) {
    console.error('❌ Erreur lors de l’envoi de l’email :', error);
    // Tu peux choisir de ne pas throw ici si tu veux éviter de bloquer le flux
    // throw new Error('Échec de l’envoi de l’email.');
  }
};

// --- ENVOI SMS ---
export const sendSMS = async (
  phone: string,
  message: string
): Promise<void> => {
  const { TWILIO_PHONE_NUMBER } = process.env;

  if (!TWILIO_PHONE_NUMBER) {
    throw new Error('TWILIO_PHONE_NUMBER manquant dans .env');
  }

  try {
    const result = await twilioClient.messages.create({
      body: message,
      to: phone,
      from: TWILIO_PHONE_NUMBER,
    });

    console.log(`📱 SMS envoyé à ${phone} ✅ SID: ${result.sid}`);
  } catch (error) {
    console.error('❌ Erreur lors de l’envoi du SMS :', error);
    // throw new Error('Échec de l’envoi du SMS.');
  }
};

// --- ENVOI PUSH NOTIFICATION Expo ---
export const sendPushNotification = async (
  expoPushToken: string,
  title: string,
  body: string
): Promise<void> => {
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: expoPushToken,
        sound: 'default',
        title,
        body,
      }),
    });
    const data = await res.json();
    console.log('📲 PUSH envoyée:', data);
  } catch (err) {
    console.error('❌ Erreur lors de l’envoi de la notification push:', err);
  }
};

// --- FONCTION CENTRALE POUR NOTIFIER UN UTILISATEUR ---
/**
 * Notifie par push, email, et SMS selon les infos disponibles
 */
export const notifyUser = async ({
  expoPushToken,
  email,
  phone,
  title,
  body,
  subject,
  sms
}: {
  expoPushToken?: string,
  email?: string,
  phone?: string,
  title: string,
  body: string,
  subject?: string,
  sms?: string,
}) => {
  try {
    if (expoPushToken) await sendPushNotification(expoPushToken, title, body);
    if (email && subject) await sendEmail({ to: email, subject, text: body });
    if (phone && sms) await sendSMS(phone, sms);
  } catch (err) {
    // Log mais ne bloque jamais la suite du code business
    console.error('❌ Erreur dans notifyUser :', err);
  }
};
