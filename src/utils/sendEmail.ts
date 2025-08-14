// src/utils/sendEmail.ts
import nodemailer from 'nodemailer';
import db from '../config/db';
import { decryptNullable } from '../utils/crypto';

export interface EmailOptions {
  // 1) adresse en clair (cas legacy)
  to?: string;

  // 2) nouvelles façons "privacy by default"
  toUserId?: string;      // résout users.email_enc par id
  toEmailEnc?: string;    // déchiffre directement
  toEmailBidx?: string;   // résout via users.email_bidx → email_enc

  subject: string;
  text?: string;
  html?: string;
}

function maskEmailForLog(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return '***';
  const u = user ?? '';
  return `${u.slice(0, 2)}***@${domain}`;
}

async function resolveEmail(opts: EmailOptions): Promise<string> {
  // a) to en clair fourni
  if (opts.to && opts.to.includes('@')) return opts.to.trim();

  // b) via toUserId
  if (opts.toUserId) {
    const { rows } = await db.query<{ email_enc: string | null }>(
      'SELECT email_enc FROM users WHERE id = $1',
      [opts.toUserId]
    );
    const enc = rows[0]?.email_enc ?? null;
    const plain = enc ? decryptNullable(enc) : null;
    if (plain && plain.includes('@')) return plain;
  }

  // c) via toEmailEnc
  if (opts.toEmailEnc) {
    const plain = decryptNullable(opts.toEmailEnc);
    if (plain && plain.includes('@')) return plain.trim();
  }

  // d) via toEmailBidx
  if (opts.toEmailBidx) {
    const { rows } = await db.query<{ email_enc: string | null }>(
      'SELECT email_enc FROM users WHERE email_bidx = $1 LIMIT 1',
      [opts.toEmailBidx]
    );
    const enc = rows[0]?.email_enc ?? null;
    const plain = enc ? decryptNullable(enc) : null;
    if (plain && plain.includes('@')) return plain.trim();
  }

  throw new Error(
    'Impossible de résoudre une adresse email valide (to / toUserId / toEmailEnc / toEmailBidx).'
  );
}

const sendEmail = async (options: EmailOptions): Promise<void> => {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!user || !pass) {
    throw new Error('❌ EMAIL_USER ou EMAIL_PASS non défini dans .env');
  }

  // 🔐 Résolution de l’adresse destinataire
  const to = await resolveEmail(options);

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // true pour 465
    auth: { user, pass },
  });

  const mailOptions = {
    from: `"Cash Hay" <${user}>`,
    to,
    subject: options.subject,
    text: options.text,
    html: options.html,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`📧 Email envoyé à ${maskEmailForLog(to)} ✅`, info.response);
  } catch (err) {
    console.error('❌ Échec de l’envoi de l’email :', err);
    throw new Error('Erreur d’envoi email');
  }
};

export default sendEmail;
