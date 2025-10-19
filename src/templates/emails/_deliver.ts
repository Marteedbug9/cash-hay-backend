// backend/src/templates/emails/_deliver.ts
import fs from 'fs';
import path from 'path';
import sendEmail, { type EmailAttachment, type EmailOptions } from '../../utils/sendEmail';

type RecipientFields = Pick<
  EmailOptions,
  'to' | 'toUserId' | 'toEmailEnc' | 'toEmailBidx' | 'fromEmail' | 'fromName' | 'replyToEmail' | 'replyToName'
>;

type Built = { subject: string; text?: string; html?: string };

/**
 * Envoie un email avec le logo inline (cid:cashhay_logo) + overrides optionnels.
 * - `recipient` peut contenir `to` OU `toUserId` OU `toEmailEnc` OU `toEmailBidx`
 * - `built` vient de tes fonctions buildXxxEmail({ ... })
 */
export async function deliverEmailWithLogo(
  recipient: RecipientFields,
  built: Built,
  extra?: {
    attachments?: EmailAttachment[];
    headers?: Record<string, string>;
    priority?: 'high' | 'normal' | 'low';
  }
) {
  // 🔹 chemin absolu de ton logo
  const logoAbs = path.resolve(
    process.cwd(),
    'src/config/assets/email/iconn.png' // ✅ ton chemin exact
  );

  // 🔹 on lit et convertit le fichier en base64 pour SendGrid
  const baseLogo: EmailAttachment = {
    filename: 'logo.png',
    content: fs.readFileSync(logoAbs).toString('base64'),
    encoding: 'base64',
    contentType: 'image/png',
    cid: 'cashhay_logo', // <img src="cid:cashhay_logo">
  };

  const attachments = [baseLogo, ...(extra?.attachments ?? [])];

  return sendEmail({
    ...recipient,
    subject: built.subject,
    text: built.text,
    html: built.html,
    attachments,
    headers: extra?.headers,
    priority: extra?.priority,
    fromName: recipient.fromName || 'Cash Hay',
    fromEmail: recipient.fromEmail || process.env.EMAIL_FROM || 'support@cash-hay.com',
    replyToEmail: recipient.replyToEmail || 'support@cash-hay.com',
    replyToName: recipient.replyToName || 'Support Cash Hay',
  });
}
