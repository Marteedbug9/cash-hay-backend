// src/utils/sendEmail.ts
import nodemailer, { SentMessageInfo } from 'nodemailer';
import db from '../config/db';
import { decryptNullable } from '../utils/crypto';

type LegacyEmailOptions = { to: string; subject: string; text?: string; html?: string; };

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
function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function resolveEmail(opts: EmailOptions | LegacyEmailOptions): Promise<string> {
  if ('to' in opts && opts.to && opts.to.includes('@')) return extractAddress(opts.to);

  const o = opts as EmailOptions;

  if (o.to && o.to.includes('@')) return extractAddress(o.to);

  if (o.toUserId) {
    const { rows } = await db.query<{ email_enc: string | null }>(
      'SELECT email_enc FROM users WHERE id = $1',
      [o.toUserId]
    );
    const enc = rows[0]?.email_enc ?? null;
    const plain = enc ? decryptNullable(enc) : null;
    const email = normalizeEmail(plain);
    if (email && email.includes('@')) return email;
  }

  if (o.toEmailEnc) {
    const email = normalizeEmail(decryptNullable(o.toEmailEnc));
    if (email && email.includes('@')) return email;
  }

  if (o.toEmailBidx) {
    const { rows } = await db.query<{ email_enc: string | null }>(
      'SELECT email_enc FROM users WHERE email_bidx = $1 LIMIT 1',
      [o.toEmailBidx]
    );
    const enc = rows[0]?.email_enc ?? null;
    const plain = enc ? decryptNullable(enc) : null;
    const email = normalizeEmail(plain);
    if (email && email.includes('@')) return email;
  }

  throw new Error('Impossible de résoudre une adresse email valide (to / toUserId / toEmailEnc / toEmailBidx).');
}

function buildGmailTransport() {
  const smtpUser = process.env.EMAIL_USER!;
  const smtpPass = process.env.EMAIL_PASS!;
  // Mode service 'gmail' (recommandé pour Workspace + App Password)
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: smtpUser, pass: smtpPass },
    connectionTimeout: 8000,
    socketTimeout: 10000,
    
    family: 4, // forcer IPv4 (évite des routes IPv6 foireuses)
  } as any);
}

function buildHostPortTransport() {
  const smtpUser = process.env.EMAIL_USER!;
  const smtpPass = process.env.EMAIL_PASS!;
  const host = process.env.EMAIL_HOST || 'smtp.gmail.com';
  const port = Number(process.env.EMAIL_PORT || 587);
  const secure = (process.env.EMAIL_SECURE || '').toLowerCase() === 'true' || port === 465;

  return nodemailer.createTransport({
    host, port, secure,
    auth: { user: smtpUser, pass: smtpPass },
    connectionTimeout: 8000,
    socketTimeout: 10000,
    tls: { servername: host, minVersion: 'TLSv1.2' }, // SNI correct
  
    family: 4,
  } as any);
}

async function makeTransport() {
  // Si EMAIL_HOST contient "gmail" → privilégier service:'gmail'
  const isGmail = (process.env.EMAIL_HOST || '').includes('gmail');
  if (isGmail) return buildGmailTransport();
  return buildHostPortTransport();
}

const sendEmail = async (options: EmailOptions | LegacyEmailOptions): Promise<SentMessageInfo> => {
  const smtpUser = process.env.EMAIL_USER;
  const smtpPass = process.env.EMAIL_PASS;
  if (!smtpUser || !smtpPass) {
    throw new Error('❌ EMAIL_USER ou EMAIL_PASS non défini dans .env');
  }

  const to = await resolveEmail(options);

  let transporter = await makeTransport();

  // Expéditeur (nettoyé)
  const fromRaw = ('fromEmail' in options && options.fromEmail) || process.env.EMAIL_FROM || smtpUser;
  const fromAddr = extractAddress(fromRaw);
  const fromName = ('fromName' in options && options.fromName) || 'Cash Hay';
  const from = `"${fromName}" <${fromAddr}>`;

  // Fallback texte si HTML seul
  const textFallback: string | undefined =
    ('text' in options && typeof options.text === 'string' && options.text.trim().length > 0)
      ? options.text
      : (('html' in options && typeof options.html === 'string' && options.html.trim().length > 0)
          ? stripHtml(options.html!)
          : undefined);

  const mailOptions: nodemailer.SendMailOptions = {
    from,
    to,
    subject: options.subject,
    text: textFallback,
    html: 'html' in options ? options.html : undefined,
    attachments: 'attachments' in options ? options.attachments : undefined,
    headers: 'headers' in options ? options.headers : undefined,
    priority: 'priority' in options ? options.priority : undefined,
  };

  try {
    // Petit test protocole (optionnel) : si ça throw ici, c’est la CONN
    await transporter.verify();

    const info = (await transporter.sendMail(mailOptions)) as SentMessageInfo;

    console.log(`📧 Email envoyé à ${maskEmailForLog(to)} ✅`, {
      messageId: info?.messageId,
      accepted: (info as any)?.accepted,
      rejected: (info as any)?.rejected,
    });

    return info;
  } catch (err: any) {
    // Si timeout en 587, on tente un fallback 465/TLS direct (utile chez certains hosts)
    const isConnTimeout = err?.code === 'ETIMEDOUT' || /timeout/i.test(err?.message || '');
    const triedPort = Number(process.env.EMAIL_PORT || 587);
    if (isConnTimeout && triedPort !== 465) {
      try {
        console.warn('⚠️ SMTP timeout en 587 — tentative fallback 465/TLS…');
        process.env.EMAIL_PORT = '465';
        process.env.EMAIL_SECURE = 'true';
        transporter = buildHostPortTransport();
        await transporter.verify();
        const info = (await transporter.sendMail(mailOptions)) as SentMessageInfo;
        console.log(`📧 (fallback 465) Email envoyé à ${maskEmailForLog(to)} ✅`, {
          messageId: info?.messageId,
          accepted: (info as any)?.accepted,
          rejected: (info as any)?.rejected,
        });
        return info;
      } catch (e2: any) {
        console.error('❌ Fallback 465 a échoué:', { code: e2?.code, cmd: e2?.command, msg: e2?.message });
      }
    }

    // Log détaillé pour diagnostiquer côté host
    console.error('❌ Échec de l’envoi de l’email :', { code: err?.code, cmd: err?.command, msg: err?.message });
    throw new Error('Erreur d’envoi email');
  }
};

export default sendEmail;
