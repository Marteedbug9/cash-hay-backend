// services/alerts.ts
import pool from '../config/db';
import { sendEmail, sendSMS } from '../utils/notificationUtils';
import { decryptNullable } from '../utils/crypto';

export async function raiseSuspiciousIPAlertForLogin(
  userRow: any,             // row venant du SELECT users dans login
  ipAddress: string,
  userAgent?: string
) {
  // Récupère les contacts (compat clair/chiffré)
  const email = decryptNullable(userRow.email_enc) ?? userRow.email ?? '';
  const phone = decryptNullable(userRow.phone_enc) ?? userRow.phone ?? '';

  // Insère l’alerte
  const ins = await pool.query(
    `INSERT INTO alerts (user_id, contact_attempt, raw_response, created_at, updated_at)
     VALUES ($1, $2, NULL, NOW(), NOW())
     RETURNING id`,
    [userRow.id, ipAddress]
  );
  const alertId = ins.rows[0].id;

  // Logs simples (optionnel)
  await pool.query(
    `INSERT INTO audit_logs (user_id, action, details, ip_address, user_agent, created_at)
     VALUES ($1, 'suspicious_ip_alert_created', $2, $3, $4, NOW())`,
    [userRow.id, `Nouvelle IP détectée: ${ipAddress} (alert_id=${alertId})`, ipAddress, userAgent || 'N/A']
  );

  // Envoi best-effort
  const tasks: Promise<any>[] = [];
  if (email) {
    tasks.push(sendEmail({
      to: email,
      subject: 'Alerte Sécurité Cash Hay',
      text: `Connexion depuis une nouvelle IP (${ipAddress}). Si c'est vous, répondez Y par SMS au message reçu. Sinon, répondez N.`
    }).catch(e => console.error('❌ Email alerte échoué:', e)));
  }
  if (phone) {
    tasks.push(sendSMS(
      phone,
      `Alerte sécurité Cash Hay : Connexion depuis une nouvelle IP (${ipAddress}). Répondez Y pour autoriser, N pour bloquer.`
    ).catch(e => console.error('❌ SMS alerte échoué:', e)));
  }
  await Promise.all(tasks);

  return alertId;
}
