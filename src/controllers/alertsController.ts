// src/controllers/alertsController.ts
import { Request, Response } from 'express';
import pool from '../config/db';
import { sendSMS, sendEmail } from '../utils/notificationUtils';
import { decryptNullable, blindIndexPhone } from '../utils/crypto';

const DEDUP_WINDOW_MIN = 60; // ↔ configurable

export const alertIfSuspiciousIP = async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: 'Non autorisé.' });

  const ipAddress =
    req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    '';

  // IP connues (dernières 5)
  const { rows: knownIPs } = await pool.query(
    `SELECT ip_address FROM login_history
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 5`,
    [user.id]
  );
  const knownIpList = knownIPs.map(r => r.ip_address);

  if (knownIpList.includes(ipAddress)) {
    // Rien à faire : IP déjà connue
    return res.status(200).json({ message: 'IP connue, aucune alerte envoyée.' });
  }

  // 🔎 Dé-duplication : existe-t-il déjà une alerte récente (≤ 60 min) pour cette IP ?
  const dedup = await pool.query(
    `SELECT id, created_at
       FROM alerts
      WHERE user_id = $1
        AND contact_attempt = $2
        AND created_at >= NOW() - INTERVAL '${DEDUP_WINDOW_MIN} minutes'
      ORDER BY created_at DESC
      LIMIT 1`,
    [user.id, ipAddress]
  );

  if ((dedup.rows?.length ?? 0) > 0) {
    // Log d’observation, pas de re-notification
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, details, ip_address, user_agent, created_at)
       VALUES ($1, 'suspicious_ip_alert_deduped',
               $2, $3, $4, NOW())`,
      [
        user.id,
        `Alerte déjà existante (id=${dedup.rows[0].id}) pour IP=${ipAddress} dans ${DEDUP_WINDOW_MIN} min`,
        ipAddress,
        req.headers['user-agent'] || 'N/A',
      ]
    );
    return res.status(200).json({ message: 'Alerte déjà présente récemment (dé-duplication).' });
  }

  // ➕ Créer une nouvelle alerte
  const ins = await pool.query(
    `INSERT INTO alerts (user_id, contact_attempt, raw_response, created_at, updated_at)
     VALUES ($1, $2, NULL, NOW(), NOW())
     RETURNING id`,
    [user.id, ipAddress]
  );
  const alertId = ins.rows[0].id as string;

  await pool.query(
    `INSERT INTO audit_logs (user_id, action, details, ip_address, user_agent, created_at)
     VALUES ($1, 'suspicious_ip_alert_created', $2, $3, $4, NOW())`,
    [user.id, `Nouvelle IP détectée: ${ipAddress}`, ipAddress, req.headers['user-agent'] || 'N/A']
  );

  // 🔐 Déchiffrer les contacts
  const phone = decryptNullable((user as any).phone_enc);
  const email = decryptNullable((user as any).email_enc);

  if (phone) {
    try {
      await sendSMS(
        phone,
        `Alerte sécurité Cash Hay : Connexion depuis une nouvelle IP (${ipAddress}). Répondez Y pour autoriser, N pour bloquer.`
      );
      await pool.query(
        `INSERT INTO audit_logs (user_id, action, details, created_at)
         VALUES ($1, 'suspicious_ip_sms_sent', $2, NOW())`,
        [user.id, `SMS alerte envoyé (alert_id=${alertId}) au ${phone}`]
      );
    } catch {
      await pool.query(
        `INSERT INTO audit_logs (user_id, action, details, created_at)
         VALUES ($1, 'suspicious_ip_sms_failed', $2, NOW())`,
        [user.id, `Échec SMS alerte (alert_id=${alertId}) au ${phone}`]
      );
    }
  }

  if (email) {
    try {
      await sendEmail({
        to: email,
        subject: 'Alerte Sécurité Cash Hay',
        text: `Connexion depuis une nouvelle IP (${ipAddress}). Si c'est vous, répondez Y par SMS. Sinon, répondez N.`,
      });
      await pool.query(
        `INSERT INTO audit_logs (user_id, action, details, created_at)
         VALUES ($1, 'suspicious_ip_email_sent', $2, NOW())`,
        [user.id, `Email alerte envoyé (alert_id=${alertId}) à ${email}`]
      );
    } catch {
      await pool.query(
        `INSERT INTO audit_logs (user_id, action, details, created_at)
         VALUES ($1, 'suspicious_ip_email_failed', $2, NOW())`,
        [user.id, `Échec email alerte (alert_id=${alertId}) à ${email}`]
      );
    }
  }

  return res.status(200).json({ message: 'Alerte créée et notifications envoyées.' });
};

// Webhook Twilio inchangé (déjà OK), rappel :
export const handleSMSReply = async (req: Request, res: Response) => {
  const from = String(req.body.From || '').trim();
  const body = String(req.body.Body || '').trim().toUpperCase();

  try {
    if (body !== 'Y' && body !== 'N') {
      return res.status(200).send('<Response></Response>');
    }

    const phoneBidx = blindIndexPhone(from);
    const userRes = await pool.query(
      `SELECT id FROM users WHERE phone_bidx = $1`,
      [phoneBidx]
    );
    if (userRes.rowCount === 0) {
      return res.status(200).send('<Response></Response>');
    }
    const userId = userRes.rows[0].id as string;

    const upd = await pool.query(
      `
      UPDATE alerts
         SET response = $1, raw_response = $2, updated_at = NOW()
       WHERE id = (
         SELECT id FROM alerts
          WHERE user_id = $3 AND response IS NULL
          ORDER BY created_at DESC
          LIMIT 1
       )
      RETURNING id, contact_attempt
      `,
      [body, body, userId]
    );

    if ((upd.rows?.length ?? 0) > 0){
      const last = upd.rows[0];
      await pool.query(
        `INSERT INTO audit_logs (user_id, action, details, created_at)
         VALUES ($1, 'suspicious_ip_user_reply', $2, NOW())`,
        [
          userId,
          `Réponse=${body}, alert_id=${last.id}, ip=${last.contact_attempt}`,
        ]
      );
      if (body === 'N') {
        await pool.query(
          `INSERT INTO audit_logs (user_id, action, details, created_at)
           VALUES ($1, 'suspicious_ip_block_recommended', $2, NOW())`,
          [userId, 'Recommandation: bloquer le compte ou forcer réauthentification']
        );
      }
    }

    return res.status(200).send('<Response></Response>');
  } catch (err) {
    console.error('❌ handleSMSReply error:', err);
    return res.status(500).send('<Response></Response>');
  }
};
