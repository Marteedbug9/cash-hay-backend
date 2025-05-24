// src/utils/sendEmail.ts

import nodemailer from 'nodemailer';

export interface EmailOptions {
  to: string;
  subject: string;
  text: string;
}

const sendEmail = async ({ to, subject, text }: EmailOptions): Promise<void> => {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // true pour le port 465
    auth: {
      user: process.env.EMAIL_USER, // Doit être défini dans .env
      pass: process.env.EMAIL_PASS, // App password si Gmail
    },
  });

  const mailOptions = {
    from: `"Cash Hay" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text,
  };

  await transporter.sendMail(mailOptions);
};

export default sendEmail;
