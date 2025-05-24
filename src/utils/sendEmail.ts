import nodemailer from 'nodemailer';

interface EmailOptions {
  to: string;
  subject: string;
  text: string;
}

const sendEmail = async ({ to, subject, text }: EmailOptions) => {
  // Configure ton transporteur SMTP
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', // ou autre selon ton fournisseur
    port: 587,
    secure: false, // true pour le port 465, false pour les autres
    auth: {
      user: process.env.EMAIL_USER, // ex : tonemail@gmail.com
      pass: process.env.EMAIL_PASS, // mot de passe ou app password
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
