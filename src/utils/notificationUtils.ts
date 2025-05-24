// src/utils/notificationUtils.ts
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

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
      service: 'gmail', // Peut être remplacé par un service SMTP personnalisé
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

// 📱 Fonction simulée pour envoyer un SMS (à remplacer par un vrai service SMS)
export const sendSMS = async (phone: string, message: string): Promise<void> => {
  try {
    console.log(`📱 SMS simulé à ${phone} : ${message}`);

    // Pour Twilio ou autre, décommenter et configurer :
    // await twilioClient.messages.create({
    //   body: message,
    //   to: phone,
    //   from: process.env.TWILIO_PHONE,
    // });

  } catch (error) {
    console.error('❌ Erreur lors de l’envoi du SMS :', error);
    throw new Error('Échec de l’envoi du SMS.');
  }
};
