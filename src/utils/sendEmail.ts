// src/utils/sendEmail.ts
import nodemailer, { SentMessageInfo } from 'nodemailer';
import sgMail from '@sendgrid/mail';
import fs from 'fs/promises';
import path from 'path';
import db from '../config/db';
import { decryptNullable } from '../utils/crypto';

type LegacyEmailOptions = { to: string; subject: string; text?: string; html?: string };

export type EmailAttachment = {
  filename?: string;
  path?: string;                // pris en charge pour SG (converti en base64) et SMTP
  content?: Buffer | string;    // Buffer ou string (base64 si encoding === 'base64')
  cid?: string;                 // pour inline <img src="cid:...">
  contentType?: string;
  encoding?: string;            // 'base64' si content est déjà encodé en base64 (string)
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

  replyToEmail?: string;
  replyToName?: string;
}

/* ------------------------------ Utils ------------------------------ */
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
  // direct "to"
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

/* ------------------------ SMTP (Gmail/Host) ------------------------ */
function buildGmailTransport() {
  const smtpUser = process.env.EMAIL_USER!;
  const smtpPass = process.env.EMAIL_PASS!;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: smtpUser, pass: smtpPass },
    connectionTimeout: 8000,
    socketTimeout: 10000,
    family: 4, // IPv4
  } as any);
}

function buildHostPortTransport() {
  const smtpUser = process.env.EMAIL_USER!;
  const smtpPass = process.env.EMAIL_PASS!;
  const host = process.env.EMAIL_HOST || 'smtp.gmail.com';
  const port = Number(process.env.EMAIL_PORT || 587);
  const secure = (process.env.EMAIL_SECURE || '').toLowerCase() === 'true' || port === 465;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user: smtpUser, pass: smtpPass },
    connectionTimeout: 8000,
    socketTimeout: 10000,
    tls: { servername: host, minVersion: 'TLSv1.2' },
    family: 4,
  } as any);
}

async function makeSmtpTransport() {
  const isGmail =
    (process.env.EMAIL_HOST || '').includes('gmail') ||
    (!process.env.EMAIL_HOST && (process.env.EMAIL_USER || '').toLowerCase().endsWith('@gmail.com'));
  if (isGmail) return buildGmailTransport();
  return buildHostPortTransport();
}

/* ------------------------ SendGrid (Web API) ------------------------ */
function sgInit() {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) throw new Error('SENDGRID_API_KEY manquant');
  sgMail.setApiKey(key);
}

async function fileToBase64(p: string): Promise<string> {
  const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  const buf = await fs.readFile(abs);
  return buf.toString('base64');
}

async function mapSgAttachments(atts?: EmailAttachment[]) {
  if (!atts?.length) return undefined;

  const out = await Promise.all(
    atts.map(async (a) => {
      let base64: string | undefined;

      if (a.content) {
        if (typeof a.content === 'string') {
          // si l'appelant a précisé encoding:'base64', on respecte tel quel
          base64 = a.encoding === 'base64' ? a.content : Buffer.from(a.content, 'utf8').toString('base64');
        } else {
          base64 = Buffer.from(a.content).toString('base64');
        }
      } else if (a.path) {
        base64 = await fileToBase64(a.path);
      }

      // SG: disposition 'inline' requise pour que content_id (cid) fonctionne comme <img src="cid:...">
      const disposition = a.cid ? 'inline' : 'attachment';

      return {
        content: base64,
        filename: a.filename || (a.path ? path.basename(a.path) : undefined),
        type: a.contentType,
        disposition,
        content_id: a.cid,
      };
    })
  );

  return out;
}

/* ----------------------------- sendEmail ---------------------------- */
const sendEmail = async (options: EmailOptions | LegacyEmailOptions): Promise<SentMessageInfo> => {
  const to = await resolveEmail(options);

  // Expéditeur
  const fromAddr =
    ('fromEmail' in options && options.fromEmail) ||
    process.env.EMAIL_FROM ||
    process.env.EMAIL_USER ||
    '';
  const fromName = ('fromName' in options && options.fromName) || process.env.EMAIL_FROM_NAME || 'Cash Hay Support';
  const replyToEmail = 'replyToEmail' in options ? options.replyToEmail : undefined;
  const replyToName = 'replyToName' in options ? options.replyToName : undefined;

  if (!fromAddr) {
    throw new Error('EMAIL_FROM ou EMAIL_USER manquant pour définir l’expéditeur.');
  }

  // Corps texte fallback si HTML seul
  const textFallback: string | undefined =
    'text' in options && typeof options.text === 'string' && options.text.trim()
      ? options.text
      : 'html' in options && typeof options.html === 'string' && options.html.trim()
      ? stripHtml(options.html)
      : undefined;

  // ✅ Garantir une string pour SG & SMTP
  const textForSg: string = textFallback ?? '';
  const textForSmtp: string = textFallback ?? '';

  /* --------- 1) Tentative via SendGrid Web API (HTTPS 443) --------- */
  try {
    sgInit();

    const sgAttachments = await mapSgAttachments('attachments' in options ? options.attachments : undefined);

    const [resp] = await sgMail.send({
      to,
      from: { email: extractAddress(fromAddr), name: fromName },
      subject: (options as any).subject,
      text: textForSg,
      html: 'html' in options ? options.html : undefined,
      attachments: sgAttachments as any,
      headers: 'headers' in options ? options.headers : undefined,
      ...(replyToEmail
        ? { replyTo: { email: extractAddress(replyToEmail), name: replyToName || undefined } }
        : {}),
    });

    // Essaye de récupérer un id de message SG si dispo
    const sgMessageId =
      // @sendgrid/mail (node-fetch Response) -> header name variant
      (resp && (resp.headers as any)?.get?.('x-message-id')) ||
      (resp && (resp.headers as any)?.get?.('x-msg-id')) ||
      'sendgrid';

    console.log(`📧(SG) Email envoyé à ${maskEmailForLog(to)} ✅`);
    return {
      messageId: String(sgMessageId),
      envelope: { from: extractAddress(fromAddr), to: [to] },
    } as unknown as SentMessageInfo;
  } catch (sgErr: any) {
    console.error('⚠️ SendGrid a échoué, bascule SMTP…', sgErr?.response?.body || sgErr?.message || sgErr);
  }

  /* --------- 2) Fallback SMTP (Gmail/Workspace ou autre) --------- */
  const smtpUser = process.env.EMAIL_USER;
  const smtpPass = process.env.EMAIL_PASS;
  if (!smtpUser || !smtpPass) {
    // Pas de SMTP valide pour fallback
    throw new Error('Erreur d’envoi email (SendGrid échoué et SMTP non configuré).');
  }

  let transporter = await makeSmtpTransport();

  const host = process.env.EMAIL_HOST || 'smtp.gmail.com';
  const port = Number(process.env.EMAIL_PORT || 587);
  const secure = (process.env.EMAIL_SECURE || '').toLowerCase() === 'true' || port === 465;

  const mailOptions: nodemailer.SendMailOptions = {
    from: `"${fromName}" <${extractAddress(fromAddr)}>`,
    to,
    subject: (options as any).subject,
    text: textForSmtp,
    html: 'html' in options ? options.html : undefined,
    attachments: 'attachments' in options ? options.attachments : undefined, // Nodemailer gère path/Buffer/cid nativement
    headers: 'headers' in options ? options.headers : undefined,
    priority: 'priority' in options ? options.priority : undefined,
    ...(replyToEmail ? { replyTo: `"${replyToName || ''}" <${extractAddress(replyToEmail)}>` } : {}),
  };

  try {
    await transporter.verify();
    const info = (await transporter.sendMail(mailOptions)) as SentMessageInfo;
    console.log(`📧(SMTP) Email envoyé à ${maskEmailForLog(to)} ✅`, {
      messageId: info?.messageId,
      accepted: (info as any)?.accepted,
      rejected: (info as any)?.rejected,
      host,
      port,
      secure,
    });
    return info;
  } catch (err: any) {
    // Fallback 465 si 587 timeout
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
        console.log(`📧(SMTP 465) Email envoyé à ${maskEmailForLog(to)} ✅`, {
          messageId: info?.messageId,
          accepted: (info as any)?.accepted,
          rejected: (info as any)?.rejected,
        });
        return info;
      } catch (e2: any) {
        console.error('❌ Fallback SMTP 465 a échoué:', { code: e2?.code, cmd: e2?.command, msg: e2?.message });
      }
    }

    console.error('❌ Échec SMTP final :', { code: err?.code, cmd: err?.command, msg: err?.message });
    throw new Error('Erreur d’envoi email (SendGrid + SMTP)');
  }
};

export default sendEmail;
