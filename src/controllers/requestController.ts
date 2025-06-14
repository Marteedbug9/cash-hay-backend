import { Request, Response } from 'express';
import pool from '../config/db';
import { v4 as uuidv4 } from 'uuid';

// ✅ Créer une demande d’argent
export const createRequest = async (req: Request, res: Response) => {
  const senderId = req.user?.id;
  const { recipientId, amount } = req.body;

  if (!senderId || !recipientId || !amount) {
    return res.status(400).json({ error: 'Champs requis manquants.' });
  }

  const transactionId = uuidv4();
  const notifId = uuidv4();

  try {
    await pool.query('BEGIN');

    console.log('➡️ Insertion transaction:', transactionId);
    const resultTx = await pool.query(
      `INSERT INTO transactions (
        id, user_id, type, amount, currency, status, description, recipient_id, created_at
      ) VALUES ($1, $2, $3, $4, 'HTG', 'pending', $5, $6, NOW()) RETURNING id`,
      [
        transactionId,
        senderId,
        'request',
        amount,
        'Demande d’argent',
        recipientId
      ]
    );

    if (resultTx.rowCount === 0) {
      throw new Error('❌ Insertion transaction échouée.');
    }

    console.log('✅ Transaction insérée');

    const senderInfo = await pool.query(
      'SELECT first_name, last_name, phone, photo_url FROM users WHERE id = $1',
      [senderId]
    );

    const sender = senderInfo.rows[0];
    if (!sender) throw new Error('❌ Expéditeur non trouvé.');

    console.log('➡️ Insertion notification:', notifId);
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

    console.log('✅ Notification insérée');

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
