import { Request, Response } from 'express';
import pool from '../config/db';
import { v4 as uuidv4 } from 'uuid';

export const createRequest = async (req: Request, res: Response) => {
  const senderId = req.user?.id;
  const { recipientId, amount } = req.body;
  const ip_address = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
  const user_agent = req.headers['user-agent'] || '';

  if (!senderId || !recipientId || !amount) {
    return res.status(400).json({ error: 'Champs requis manquants.' });
  }

  const transactionId = uuidv4();
  const notifId = uuidv4();

  try {
    await pool.query('BEGIN');

    // Enregistre la transaction (pending)
    await pool.query(
      `INSERT INTO transactions (
        id, user_id, type, amount, currency, status, description, recipient_id, ip_address, user_agent, created_at
      ) VALUES ($1, $2, $3, $4, 'HTG', 'pending', $5, $6, $7, $8, NOW())`,
      [
        transactionId,
        senderId,
        'request',
        amount,
        'Demande d’argent',
        recipientId,
        ip_address,
        user_agent
      ]
    );

    // Audit log
    await pool.query(
      `INSERT INTO audit_logs (id, user_id, action, ip_address, user_agent, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        uuidv4(),
        senderId,
        'request_money',
        ip_address,
        user_agent,
        `Demande ${amount} HTG à ${recipientId}`
      ]
    );

    // Infos de l'expéditeur pour la notification
    const senderInfo = await pool.query(
      'SELECT first_name, last_name, phone, photo_url FROM users WHERE id = $1',
      [senderId]
    );

    const sender = senderInfo.rows[0];
    if (!sender) throw new Error('❌ Expéditeur non trouvé.');

    // Notif
    await pool.query(
      `INSERT INTO notifications (
        id, user_id, type, from_first_name, from_last_name, from_contact, from_profile_image, amount, status, transaction_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)`,
      [
        notifId,
        recipientId,
        'request',
        sender.first_name,
        sender.last_name,
        sender.phone,
        sender.photo_url,
        amount,
        transactionId,
      ]
    );

    await pool.query('COMMIT');
    res.status(200).json({ message: 'Demande d’argent enregistrée avec succès.', transactionId });

  } catch (err) {
    console.error('❌ Erreur createRequest :', err);
    await pool.query('ROLLBACK');
    res.status(500).json({ error: 'Erreur serveur lors de la demande.' });
  }
};

// ✅ Récupérer la liste des demandes (envoyées ou reçues)
export const getRequests = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const direction = req.query.direction as string; // doit être "sent" ou "received"

  if (!['sent', 'received'].includes(direction)) {
    return res.status(400).json({
      error: "Paramètre 'direction' invalide. Utilisez 'sent' ou 'received'.",
    });
  }

  try {
    let query = '';
    let params: any[] = [];

    if (direction === 'sent') {
      query = `
        SELECT t.id, t.amount, t.currency, t.status, t.created_at,
               u.username AS other_party_username,
               u.photo_url AS other_party_image,
               t.description
        FROM transactions t
        JOIN users u ON u.id = t.recipient_id
        WHERE t.type = 'request' AND t.user_id = $1
        ORDER BY t.created_at DESC
      `;
      params = [userId];
    } else {
      query = `
        SELECT t.id, t.amount, t.currency, t.status, t.created_at,
               u.username AS other_party_username,
               u.photo_url AS other_party_image,
               t.description
        FROM transactions t
        JOIN users u ON u.id = t.user_id
        WHERE t.type = 'request' AND t.recipient_id = $1
        ORDER BY t.created_at DESC
      `;
      params = [userId];
    }

    const result = await pool.query(query, params);
    return res.status(200).json({ requests: result.rows });
  } catch (error) {
    console.error('❌ Erreur getRequests :', error);
    return res.status(500).json({ error: 'Erreur serveur lors de la récupération des demandes.' });
  }
};
