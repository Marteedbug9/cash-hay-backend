import nodemailer from 'nodemailer';
import twilio from 'twilio';
import dotenv from 'dotenv';

dotenv.config();

// Initialiser Twilio
const twilioClient = twilio(
  process.env.TWILIO_SID!,
  process.env.TWILIO_TOKEN!
);

// ✅ Envoyer un email
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
    throw new Error('Échec de l’envoi de l’email.');
  }
};

// ✅ Envoyer un SMS
export const sendSMS = async (
  phone: string,
  message: string
): Promise<void> => {
  const { TWILIO_PHONE } = process.env;

  if (!TWILIO_PHONE) {
    throw new Error('TWILIO_PHONE manquant dans .env');
  }

  try {
    const result = await twilioClient.messages.create({
      body: message,
      to: phone,
      from: TWILIO_PHONE,
    });

    console.log(`📱 SMS envoyé à ${phone} ✅ SID: ${result.sid}`);
  } catch (error) {
    console.error('❌ Erreur lors de l’envoi du SMS :', error);
    throw new Error('Échec de l’envoi du SMS.');
  }
};
