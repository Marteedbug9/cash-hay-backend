// src/utils/sendEmail.ts
import nodemailer, { SentMessageInfo } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import db from '../config/db';
import { decryptNullable } from '../utils/crypto';

export type EmailAttachment = {
  filename?: string;
  path?: string;
  content?: any;      // Buffer | string
  cid?: string;       // <img src="cid:...">
  contentType?: string;
  encoding?: string;
};

export interface EmailOptions {
  // 1) adresse en clair (legacy)
  to?: string;

  // 2) privacy by default (résolution DB)
  toUserId?: string;   // users.email_enc via id
  toEmailEnc?: string; // déchiffre directement
  toEmailBidx?: string;// users.email_bidx -> email_enc

  subject: string;
  text?: string;
  html?: string;

  // Pièces jointes / en-têtes / priorité
  attachments?: EmailAttachment[];
  headers?: Record<string, string>;
  priority?: 'high' | 'normal' | 'low';

  // Override expéditeur (optionnel)
  fromEmail?: string;
  fromName?: string;
}

function maskEmailForLog(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return '***';
  const u = user ?? '';
  return `${u.slice(0, 2)}***@${domain}`;
}

async function resolveEmail(opts: EmailOptions): Promise<string> {
  // a) to en clair
  if (opts.to && opts.to.includes('@')) return opts.to.trim();

  // b) via toUserId
  if (opts.toUserId) {
    const { rows } = await db.query<{ email_enc: string | null }>(
      'SELECT email_enc FROM users WHERE id = $1',
      [opts.toUserId]
    );
    const enc = rows[0]?.email_enc ?? null;
    const plain = enc ? decryptNullable(enc) : null;
    if (plain && plain.includes('@')) return plain.trim();
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

const sendEmail = async (options: EmailOptions): Promise<SentMessageInfo> => {
  const smtpUser = process.env.EMAIL_USER;
  const smtpPass = process.env.EMAIL_PASS;
  if (!smtpUser || !smtpPass) {
    throw new Error('❌ EMAIL_USER ou EMAIL_PASS non défini dans .env');
  }

  // Résolution destinataire
  const to = await resolveEmail(options);

  // Paramètres SMTP (explicites pour Render)
  const host = process.env.EMAIL_HOST || 'smtp.gmail.com';
  const port = Number(process.env.EMAIL_PORT || 587);
  const secure = port === 465; // 465 = TLS direct ; 587 = STARTTLS

  // Typage explicite pour éviter TS2769
  const transportOpts: SMTPTransport.Options = {
    host,
    port,
    secure,
    auth: { user: smtpUser, pass: smtpPass }, // Gmail: App Password requis (2FA)
    connectionTimeout: 8_000,  // 8s
    socketTimeout: 10_000,     // 10s
    tls: {
      minVersion: 'TLSv1.2',
      servername: host,        // SNI correct
    },
  };
  // Si tu veux forcer IPv4 et éviter d’anciens soucis de typage:
  // (transportOpts as any).family = 4;

  const transporter = nodemailer.createTransport(transportOpts);

  // Expéditeur
  const fromEmail = options.fromEmail || process.env.EMAIL_FROM || smtpUser;
  const fromName = options.fromName || 'Cash Hay';
  const from = `"${fromName}" <${fromEmail}>`;

  // Fallback texte si HTML seul (meilleure délivrabilité)
  const textFallback =
    options.text ??
    (options.html ? options.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '');

  const mailOptions: SMTPTransport.MailOptions = {
    from,
    to,
    subject: options.subject,
    text: textFallback,
    html: options.html,
    attachments: options.attachments as any, // cast : conforme à SMTPTransport.Attachment
    headers: options.headers,
    priority: options.priority,
  };

  try {
    // Optionnel : await transporter.verify();
    const info = await transporter.sendMail(mailOptions);
    console.log(`📧 Email envoyé à ${maskEmailForLog(to)} ✅`, info.response);
    return info;
  } catch (err: unknown) {
    console.error('❌ Échec de l’envoi de l’email :', (err as any)?.message || err);
    throw new Error('Erreur d’envoi email');
  }
};

export default sendEmail;
