// src/controllers/requestController.ts
import { Request, Response } from 'express';
import pool from '../config/db';
import { v4 as uuidv4 } from 'uuid';
import { decryptNullable, blindIndexEmail, blindIndexPhone } from '../utils/crypto';
import { addNotification } from './notificationsController'; // réutilise la logique notif (chiffrage interne)

export const createRequest = async (req: Request, res: Response) => {
  const senderId = req.user?.id;
  const { recipientId, amount } = req.body as { recipientId?: string; amount?: number };

  const ip_address =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    '';
  const user_agent = req.headers['user-agent'] || '';

  if (!senderId || !recipientId || amount == null) {
    return res.status(400).json({ error: 'Champs requis manquants.' });
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Montant invalide.' });
  }

  const transactionId = uuidv4();

  try {
    await pool.query('BEGIN');

    // ✅ Récupère les infos du destinataire (pour remplir recipient_* dans transactions)
    // On lit les colonnes chiffrées / bidx et on les "copie" telles quelles dans la transaction.
    const recipientRes = await pool.query(
      `SELECT id, email_enc, email_bidx, phone_enc, phone_bidx
         FROM users
        WHERE id = $1
        LIMIT 1`,
      [recipientId]
    );
    if (recipientRes.rowCount === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Destinataire introuvable.' });
    }
    const recipient = recipientRes.rows[0] as {
      id: string;
      email_enc: string | null;
      email_bidx: string | null;
      phone_enc: string | null;
      phone_bidx: string | null;
    };

    // ✅ Insère la transaction (pending) en HTG + colonnes destinataire chiffrées
    await pool.query(
      `INSERT INTO transactions (
         id, user_id, type, amount, currency, status, description,
         recipient_id,
         recipient_email_enc, recipient_email_bidx,
         recipient_phone_enc, recipient_phone_bidx,
         ip_address, user_agent, created_at
       ) VALUES (
         $1, $2, 'request', $3, 'HTG', 'pending', $4,
         $5,
         $6, $7,
         $8, $9,
         $10, $11, NOW()
       )`,
      [
        transactionId,
        senderId,
        amount,
        'Demande d’argent',
        recipientId,
        recipient.email_enc ?? null,
        recipient.email_bidx ?? (null as any),
        recipient.phone_enc ?? null,
        recipient.phone_bidx ?? (null as any),
        ip_address,
        user_agent,
      ]
    );

    // ✅ Audit log
    await pool.query(
      `INSERT INTO audit_logs (id, user_id, action, ip_address, user_agent, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        uuidv4(),
        senderId,
        'request_money',
        ip_address,
        user_agent,
        `Demande ${amount} HTG à user:${recipientId}`,
      ]
    );

    // ✅ Infos de l’expéditeur (pour la notif côté destinataire)
    const senderInfo = await pool.query(
      `SELECT first_name, last_name, phone_enc, email_enc, photo_url
         FROM users
        WHERE id = $1
        LIMIT 1`,
      [senderId]
    );
    if (senderInfo.rowCount === 0) {
      throw new Error('Expéditeur introuvable.');
    }
    const sender = senderInfo.rows[0] as {
      first_name: string | null;
      last_name: string | null;
      phone_enc: string | null;
      email_enc: string | null;
      photo_url: string | null;
    };

    // on choisit un "contact" principal pour l’affichage (phone si dispo, sinon email)
    const senderPhone = decryptNullable(sender.phone_enc) || '';
    const senderEmail = decryptNullable(sender.email_enc) || '';
    const from_contact = senderPhone || senderEmail || '—';

    // ✅ Notification (réutilise addNotification qui gère le chiffrage interne si tu l’as adapté)
    await addNotification({
      user_id: recipientId,              // destinataire de la notif (celui qui reçoit la demande)
      type: 'request',
      from_first_name: sender.first_name || '',
      from_last_name: sender.last_name || '',
      from_contact,                      // en clair ici; addNotification peut chiffrer selon ta version
      from_profile_image: sender.photo_url || '',
      amount,
      status: 'pending',
      transaction_id: transactionId,
    });

    await pool.query('COMMIT');
    return res
      .status(200)
      .json({ message: 'Demande d’argent enregistrée avec succès.', transactionId });
  } catch (err) {
    console.error('❌ Erreur createRequest :', err);
    await pool.query('ROLLBACK');
    return res.status(500).json({ error: 'Erreur serveur lors de la demande.' });
  }
};

// ✅ Récupérer la liste des demandes (envoyées ou reçues)
export const getRequests = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const direction = String(req.query.direction || '');

  if (!userId) {
    return res.status(401).json({ error: 'Utilisateur non authentifié.' });
  }
  if (!['sent', 'received'].includes(direction)) {
    return res
      .status(400)
      .json({ error: "Paramètre 'direction' invalide. Utilisez 'sent' ou 'received'." });
  }

  try {
    let query = '';
    let params: any[] = [];

    if (direction === 'sent') {
      query = `
        SELECT
          t.id, t.amount, t.currency, t.status, t.created_at, t.description,
          u.username AS other_party_username,
          u.photo_url AS other_party_image
        FROM transactions t
        JOIN users u ON u.id = t.recipient_id
        WHERE t.type = 'request' AND t.user_id = $1
        ORDER BY t.created_at DESC
      `;
      params = [userId];
    } else {
      query = `
        SELECT
          t.id, t.amount, t.currency, t.status, t.created_at, t.description,
          u.username AS other_party_username,
          u.photo_url AS other_party_image
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
    return res
      .status(500)
      .json({ error: 'Erreur serveur lors de la récupération des demandes.' });
  }
};
