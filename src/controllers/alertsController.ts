import { Request, Response } from 'express';
import pool from '../config/db';
import { sendSMS, sendEmail } from '../utils/notificationUtils';

export const alertIfSuspiciousIP = async (req: Request, res: Response) => {
  const user = req.user; // Assure-toi que verifyToken/verifyUser a mis req.user
  if (!user) return res.status(401).json({ error: 'Non autorisé.' });

  // Prends l’adresse IP
  const ipAddress =
    req.headers['x-forwarded-for']?.toString().split(',')[0] ||
    req.socket.remoteAddress ||
    '';

  // Récupère les IP connues de l'utilisateur
  const { rows: knownIPs } = await pool.query(
    `SELECT ip_address FROM login_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`,
    [user.id]
  );
  const knownIpList = knownIPs.map(row => row.ip_address);

  if (!knownIpList.includes(ipAddress)) {
    // Ajoute une alerte en base
    await pool.query(
      `INSERT INTO alerts (user_id, contact_attempt, raw_response) VALUES ($1, $2, $3)`,
      [user.id, ipAddress, null]
    );
    // Envoi SMS (2 paramètres !)
    // Juste avant d’envoyer le SMS
if (user.phone) {
  await sendSMS(
    user.phone,
    `Alerte sécurité Cash Hay : Connexion depuis une nouvelle IP (${ipAddress}). Répondez Y pour autoriser, N pour bloquer.`
  );
}

// Juste avant d’envoyer l’email
if (user.email) {
  await sendEmail({
    to: user.email,
    subject: 'Alerte Sécurité Cash Hay',
    text: `Connexion depuis une nouvelle IP (${ipAddress}). Si c'est vous, répondez Y par SMS. Sinon, répondez N.`
  });
}

  }

  // Peut faire un res.json ou continuer ton flow habituel
  return res.status(200).json({ message: 'Alerte traitée (si nécessaire).' });
};
