// src/utils/sendEmail.ts

import nodemailer from 'nodemailer';

export interface EmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

const sendEmail = async ({ to, subject, text, html }: EmailOptions): Promise<void> => {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!user || !pass) {
    throw new Error('❌ EMAIL_USER ou EMAIL_PASS non défini dans .env');
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // true pour port 465
    auth: {
      user,
      pass,
    },
  });

  const mailOptions = {
    from: `"Cash Hay" <${user}>`,
    to,
    subject,
    text,
    html,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`📧 Email envoyé à ${to} ✅`, info.response);
  } catch (err) {
    console.error('❌ Échec de l’envoi de l’email :', err);
    throw new Error('Erreur d’envoi email');
  }
};

export default sendEmail;