import nodemailer from 'nodemailer';
import twilio from 'twilio';
import dotenv from 'dotenv';

dotenv.config();

// 🌐 Variables d'environnement obligatoires
const { EMAIL_USER, EMAIL_PASS, TWILIO_SID, TWILIO_TOKEN, TWILIO_PHONE_NUMBER } = process.env;

// 📨 Transporteur Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS,
  },
});

// 📱 Client Twilio
const twilioClient = twilio(TWILIO_SID!, TWILIO_TOKEN!);

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
  if (!EMAIL_USER || !EMAIL_PASS) {
    throw new Error('EMAIL_USER ou EMAIL_PASS manquant dans .env');
  }

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
    throw new Error('Échec de l’envoi du SMS.');
  }
};
