import nodemailer from 'nodemailer';
import twilio from 'twilio';
import dotenv from 'dotenv';

dotenv.config();

// Client Twilio
const twilioClient = twilio(process.env.TWILIO_SID!, process.env.TWILIO_TOKEN!);

// 📧 Fonction pour envoyer un email
export const sendEmail = async ({
  to,
  subject,
  text,
}: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error('Les identifiants email ne sont pas configurés.');
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"Cash Hay" <${process.env.EMAIL_USER}>`,
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

// 📱 Fonction pour envoyer un SMS via Twilio (désactivée temporairement)
/*
export const sendSMS = async (phone: string, message: string): Promise<void> => {
  if (!process.env.TWILIO_PHONE) {
    throw new Error('Numéro Twilio non configuré.');
  }

  try {
    const result = await twilioClient.messages.create({
      body: message,
      to: phone,
      from: process.env.TWILIO_PHONE,
    });

    console.log(`📱 SMS envoyé à ${phone} - SID: ${result.sid}`);
  } catch (error) {
    console.error('❌ Erreur lors de l’envoi du SMS :', error);
    throw new Error('Échec de l’envoi du SMS.');
  }
};
*/

// 💡 Mode debug temporaire (aucun SMS réellement envoyé)
export const sendSMS = async (phone: string, message: string): Promise<void> => {
  console.log(`[DEBUG] SMS désactivé - à ${phone}: ${message}`);
};
