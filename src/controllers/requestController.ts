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

  try {
    const transactionId = uuidv4();

    // Étape 1 – Enregistrer la transaction (statut "pending")
    await pool.query(
      `INSERT INTO transactions (
        id, user_id, type, amount, currency, status, description, recipient_id, created_at
      ) VALUES ($1, $2, 'request', $3, 'HTG', 'pending', $4, $5, NOW())`,
      [
        transactionId,
        senderId,
        amount,
        'Demande d’argent',
        recipientId
      ]
    );

    // Étape 2 – Obtenir les infos de l’expéditeur
    const senderInfo = await pool.query(
      'SELECT first_name, last_name, phone, photo_url FROM users WHERE id = $1',
      [senderId]
    );

    const sender = senderInfo.rows[0];
    if (!sender) {
      console.error('❌ Expéditeur non trouvé dans la DB');
      return res.status(404).json({ error: 'Expéditeur introuvable.' });
    }

    // Étape 3 – Créer la notification liée à la demande
    await pool.query(
      `INSERT INTO notifications (
        id, user_id, type, from_first_name, from_last_name, from_contact, from_profile_image, amount, status, transaction_id
      ) VALUES ($1, $2, 'request', $3, $4, $5, $6, $7, 'pending', $8)`,
      [
        uuidv4(),
        recipientId,
        sender.first_name,
        sender.last_name,
        sender.phone,
        sender.photo_url,
        amount,
        transactionId,
      ]
    );

    res.status(201).json({ message: '✅ Demande envoyée avec succès.', transactionId });
  } catch (err) {
    console.error('❌ Erreur lors de l’envoi de la demande :', err);
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
