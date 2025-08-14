// src/utils/notificationUtils.ts
import nodemailer from 'nodemailer';
import twilio from 'twilio';
import dotenv from 'dotenv';

dotenv.config();

/* ===========================
   TWILIO
=========================== */
const twilioClient = twilio(
  process.env.TWILIO_SID!,
  process.env.TWILIO_TOKEN!
);

/* ===========================
   EMAIL
=========================== */
export type MailArgs = {
  to: string;
  subject: string;
  text?: string;   // optionnel
  html?: string;   // optionnel
};

// Transporter créé une seule fois (perf + stabilité)
// -> Par défaut Gmail via APP PASSWORD (2FA requis)
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

if (!EMAIL_USER || !EMAIL_PASS) {
  // On n'empêche pas le process de démarrer, mais on log une alerte claire
  console.warn('⚠️ EMAIL_USER ou EMAIL_PASS manquant dans .env — sendEmail échouera.');
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  // Si tu utilises un SMTP custom, remplace par:
  // host: process.env.MAIL_HOST,
  // port: Number(process.env.MAIL_PORT) || 587,
  // secure: !!Number(process.env.MAIL_SECURE), // true si 465
  // auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
});

function stripHtml(input: string) {
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export const sendEmail = async ({ to, subject, text, html }: MailArgs): Promise<void> => {
  if (!EMAIL_USER || !EMAIL_PASS) {
    throw new Error('EMAIL_USER ou EMAIL_PASS manquant dans .env');
  }

  try {
    await transporter.sendMail({
      from: `"Cash Hay" <${EMAIL_USER}>`,
      to,
      subject,
      // Toujours fournir un text fallback pour la délivrabilité
      text: text ?? (html ? stripHtml(html) : ''),
      html,
    });
    console.log(`📨 Email envoyé à ${to}`);
  } catch (error) {
    console.error('❌ Erreur lors de l’envoi de l’email :', error);
    // À toi de décider si tu veux throw ici:
    // throw new Error('Échec de l’envoi de l’email.');
  }
};

/* ===========================
   SMS
=========================== */
export const sendSMS = async (phone: string, message: string): Promise<void> => {
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

/* ===========================
   PUSH (Expo)
=========================== */
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

/* ===========================
   NOTIFICATION CENTRALE
=========================== */
/**
 * Notifie par push, email (HTML supporté), et SMS selon les infos disponibles.
 * - `body` sert pour le push et comme fallback texte pour l’email si `emailText` absent.
 */
export const notifyUser = async ({
  expoPushToken,
  email,
  phone,
  title,
  body,
  subject,
  sms,
  emailText,
  emailHtml,
}: {
  expoPushToken?: string;
  email?: string;
  phone?: string;
  title: string;         // utilisé pour PUSH
  body: string;          // utilisé pour PUSH et fallback email text
  subject?: string;      // requis si email
  sms?: string;          // texte SMS (sinon pas d’envoi SMS)
  emailText?: string;    // texte email explicite (sinon fallback = body)
  emailHtml?: string;    // version HTML de l’email (optionnelle)
}) => {
  try {
    if (expoPushToken) await sendPushNotification(expoPushToken, title, body);
    if (email && subject) {
      await sendEmail({
        to: email,
        subject,
        text: emailText ?? body,
        html: emailHtml, // nouveau champ pris en charge
      });
    }
    if (phone && sms) await sendSMS(phone, sms);
  } catch (err) {
    // On log, mais on ne bloque pas ton flux business
    console.error('❌ Erreur dans notifyUser :', err);
  }
};
