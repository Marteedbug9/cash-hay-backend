// src/controllers/alertsController.ts
import { Request, Response } from 'express';
import pool from '../config/db';
import { sendSMS, sendEmail } from '../utils/notificationUtils';
import { decryptNullable, blindIndexPhone } from '../utils/crypto';
import { fetchIPLocation, formatLocationLabel } from '../utils/ipLocation';

const DEDUP_WINDOW_MIN = 60; // ↔ configurable

export const alertIfSuspiciousIP = async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: 'Non autorisé.' });

  const rawIp =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    '';

  // IP déjà connue (5 dernières)
  const { rows: knownIPs } = await pool.query(
    `SELECT ip_address FROM login_history
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 5`,
    [user.id]
  );
  if (knownIPs.map(r => r.ip_address).includes(rawIp)) {
    return res.status(200).json({ message: 'IP connue, aucune alerte envoyée.' });
  }

  // Dé-duplication 60 min
  const dedup = await pool.query(
    `SELECT id FROM alerts
      WHERE user_id = $1
        AND contact_attempt = $2
        AND created_at >= NOW() - INTERVAL '${DEDUP_WINDOW_MIN} minutes'
      ORDER BY created_at DESC
      LIMIT 1`,
    [user.id, rawIp]
  );
  if (dedup.rowCount) {
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, details, ip_address, user_agent, created_at)
       VALUES ($1, 'suspicious_ip_alert_deduped',
               $2, $3, $4, NOW())`,
      [
        user.id,
        `Alerte déjà existante pour IP=${rawIp} dans ${DEDUP_WINDOW_MIN} min`,
        rawIp,
        req.headers['user-agent'] || 'N/A',
      ]
    );
    return res.status(200).json({ message: 'Alerte déjà présente récemment (dé-duplication).' });
  }

  // 🔎 Localisation via ip-api
  const loc = await fetchIPLocation(rawIp);
  const locationLabel = formatLocationLabel(loc);

  // ➕ Créer l’alerte
  const ins = await pool.query(
    `INSERT INTO alerts (user_id, contact_attempt, raw_response, created_at)
     VALUES ($1, $2, NULL, NOW())
     RETURNING id`,
    [user.id, rawIp]
  );
  const alertId = ins.rows[0].id as string;

  // ⬇️ AJOUT : persister la localisation si dispo (sans bloquer)
  if (loc) {
    try {
      await pool.query(
        `UPDATE alerts
           SET ip_city = $1, ip_region = $2, ip_country = $3, ip_lat = $4, ip_lon = $5
         WHERE id = $6`,
        [loc.city, loc.region, loc.country, loc.lat, loc.lon, alertId]
      );
    } catch {}
  }

  await pool.query(
    `INSERT INTO audit_logs (user_id, action, details, ip_address, user_agent, created_at)
     VALUES ($1, 'suspicious_ip_alert_created', $2, $3, $4, NOW())`,
    [user.id, `Nouvelle IP détectée: ${rawIp} (${locationLabel})`, rawIp, req.headers['user-agent'] || 'N/A']
  );

  // 🔐 Récupère les contacts depuis la DB (compat colonnes enc/plain)
  const cRes = await pool.query(
    'SELECT email, email_enc, phone, phone_enc FROM users WHERE id = $1',
    [user.id]
  );
  const c = cRes.rows[0] || {};
  const email = decryptNullable(c.email_enc) ?? c.email ?? '';
  const phone = decryptNullable(c.phone_enc) ?? c.phone ?? '';

  // ✉️ / 📱 Notifications avec localisation
  if (phone) {
    try {
      await sendSMS(
        phone,
        `Alerte Cash Hay : connexion depuis ${locationLabel} (IP ${rawIp}). Répondez Y pour autoriser, N pour bloquer.`
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
        text: `Connexion depuis ${locationLabel} (IP ${rawIp}). Si c'est vous, répondez Y par SMS. Sinon, répondez N.`,
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
