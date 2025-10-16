// src/utils/sendEmail.ts
import nodemailer, { SentMessageInfo } from 'nodemailer';
import db from '../config/db';
import { decryptNullable } from '../utils/crypto';

type LegacyEmailOptions = {
  to: string; subject: string; text?: string; html?: string;
};

export type EmailAttachment = {
  filename?: string;
  path?: string;
  content?: Buffer | string;
  cid?: string;
  contentType?: string;
  encoding?: string;
};

export interface EmailOptions {
  to?: string;
  toUserId?: string;
  toEmailEnc?: string;
  toEmailBidx?: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: EmailAttachment[];
  headers?: Record<string, string>;
  priority?: 'high' | 'normal' | 'low';
  fromEmail?: string;
  fromName?: string;
}

// -- Utils
function normalizeEmail(e?: string | null): string | null {
  const v = (e ?? '').trim();
  return v ? v.toLowerCase() : null;
}
function extractAddress(emailOrMailbox: string): string {
  const m = emailOrMailbox.match(/<\s*([^>]+)\s*>/);
  return normalizeEmail(m ? m[1] : emailOrMailbox) ?? '';
}
function maskEmailForLog(emailLike: string): string {
  const addr = extractAddress(emailLike);
  const [user, domain] = addr.split('@');
  if (!domain) return '***';
  return `${(user ?? '').slice(0, 2)}***@${domain}`;
}

async function resolveEmail(opts: EmailOptions | LegacyEmailOptions): Promise<string> {
  // Legacy path
  if ('to' in opts && opts.to && opts.to.includes('@')) {
    return extractAddress(opts.to);
  }
  // New paths
  const o = opts as EmailOptions;

  if (o.to && o.to.includes('@')) return extractAddress(o.to);

  if (o.toUserId) {
    const { rows } = await db.query<{ email_enc: string | null }>(
      'SELECT email_enc FROM users WHERE id = $1',
      [o.toUserId]
    );
    const plain = normalizeEmail(rows[0]?.email_enc ? decryptNullable(rows[0]!.email_enc!) : null);
    if (plain && plain.includes('@')) return plain;
  }

  if (o.toEmailEnc) {
    const plain = normalizeEmail(decryptNullable(o.toEmailEnc));
    if (plain && plain.includes('@')) return plain;
  }

  if (o.toEmailBidx) {
    const { rows } = await db.query<{ email_enc: string | null }>(
      'SELECT email_enc FROM users WHERE email_bidx = $1 LIMIT 1',
      [o.toEmailBidx]
    );
    const plain = normalizeEmail(rows[0]?.email_enc ? decryptNullable(rows[0]!.email_enc!) : null);
    if (plain && plain.includes('@')) return plain;
  }

  throw new Error('Impossible de résoudre une adresse email valide (to / toUserId / toEmailEnc / toEmailBidx).');
}

const sendEmail = async (options: EmailOptions | LegacyEmailOptions): Promise<SentMessageInfo> => {
  const smtpUser = process.env.EMAIL_USER;
  const smtpPass = process.env.EMAIL_PASS;
  if (!smtpUser || !smtpPass) {
    throw new Error('❌ EMAIL_USER ou EMAIL_PASS non défini dans .env');
  }

  const to = await resolveEmail(options);

  const host = process.env.EMAIL_HOST || 'smtp.gmail.com';
  const port = Number(process.env.EMAIL_PORT || 587);
  const secure = (process.env.EMAIL_SECURE || '').toLowerCase() === 'true' || port === 465;

  const transporter = nodemailer.createTransport({
    host, port, secure,
    auth: { user: smtpUser, pass: smtpPass },
    // pool: true, // dé-commente si envoi volumineux
  });

  const fromEmail = ('fromEmail' in options && options.fromEmail) || process.env.EMAIL_FROM || smtpUser;
  const fromName = ('fromName' in options && options.fromName) || 'Cash Hay';
  const from = `"${fromName}" <${fromEmail}>`;

  const mailOptions = {
    from,
    to,
    subject: options.subject,
    text: options.text,
    html: options.html,
    attachments: 'attachments' in options ? options.attachments : undefined,
    headers: 'headers' in options ? options.headers : undefined,
    priority: 'priority' in options ? options.priority : undefined,
  };

  try {
    // Optionnel: await transporter.verify();
    const info = await transporter.sendMail(mailOptions);
    console.log(`📧 Email envoyé à ${maskEmailForLog(to)} ✅`, {
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected
    });
    return info;
  } catch (err) {
    console.error('❌ Échec de l’envoi de l’email :', err);
    throw new Error('Erreur d’envoi email');
  }
};

export default sendEmail;
