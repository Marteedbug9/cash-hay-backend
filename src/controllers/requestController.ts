// src/controllers/requestController.ts
import { Request, Response } from 'express';
import pool from '../config/db';
import { v4 as uuidv4 } from 'uuid';
import { decryptNullable, blindIndexEmail, blindIndexPhone } from '../utils/crypto';
import { addNotification } from './notificationsController'; // réutilise la logique notif (chiffrage interne)

// helpers simples
const isEmail = (v: string) => /\S+@\S+\.\S+/.test(v);
const normalizeContact = (raw: string) => {
  const s = String(raw || '').trim();
  return isEmail(s) ? s.toLowerCase() : s.replace(/\D/g, '');
};

export const createRequest = async (req: Request, res: Response) => {
  const senderId = req.user?.id;
  const { contact, amount } = req.body as { contact?: string; amount?: number };

  const ip_address =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress || '';
  const user_agent = req.headers['user-agent'] || '';

  if (!senderId || !contact || amount == null) {
    return res.status(400).json({ error: 'Champs requis manquants (contact, amount).' });
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Montant invalide.' });
  }

  const normalized = normalizeContact(contact);
  const transactionId = uuidv4();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Résoudre le DESTINATAIRE via members.contact
    const mRec = await client.query(
      `SELECT id AS member_id, user_id
         FROM members
        WHERE contact = $1
        LIMIT 1`,
      [normalized]
    );
    if (mRec.rowCount === 0 || !mRec.rows[0].user_id) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "Ce contact n'est pas un membre actif." });
    }
    const recipientMemberId: string = mRec.rows[0].member_id;
    const recipientUserId: string = mRec.rows[0].user_id;

    // 2) Empêcher de s’auto-demander
    const mSender = await client.query(
      `SELECT contact FROM members WHERE user_id = $1 LIMIT 1`,
      [senderId]
    );
    const senderContact = mSender.rows[0]?.contact ? normalizeContact(mSender.rows[0].contact) : null;
    if (senderContact && senderContact === normalized) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Impossible de vous envoyer une demande à vous-même.' });
    }

    // 3) Copier les colonnes chiffrées du destinataire (si tu les utilises dans transactions)
    const uRec = await client.query(
      `SELECT email_enc, email_bidx, phone_enc, phone_bidx
         FROM users
        WHERE id = $1
        LIMIT 1`,
      [recipientUserId]
    );
    if (uRec.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Utilisateur destinataire introuvable.' });
    }
    const recip = uRec.rows[0];

    // 4) INSERT transaction (pending) en HTG
    await client.query(
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
        recipientUserId,
        recip.email_enc ?? null,
        recip.email_bidx ?? null,
        recip.phone_enc ?? null,
        recip.phone_bidx ?? null,
        ip_address,
        user_agent,
      ]
    );

    // 5) Infos d’affichage EXPÉDITEUR (users + members)
    const senderInfo = await client.query(
      `SELECT u.first_name, u.last_name, u.photo_url, m.contact
         FROM users u
         LEFT JOIN members m ON m.user_id = u.id
        WHERE u.id = $1
        LIMIT 1`,
      [senderId]
    );
    const { first_name, last_name, photo_url } = senderInfo.rows[0] || {};
    const from_contact = senderInfo.rows[0]?.contact || '—';

    // 6) Notification chez le destinataire (utilise ton addNotification qui chiffre en DB)
    await addNotification({
      user_id: recipientUserId,     // le propriétaire qui reçoit la notif
      type: 'request',
      from_first_name: first_name || '',
      from_last_name:  last_name  || '',
      from_contact,                 // vient de members.contact (expéditeur)
      from_profile_image: photo_url || '',
      amount,
      status: 'pending',
      transaction_id: transactionId,
    });

    // 7) Audit
    await client.query(
      `INSERT INTO audit_logs (id, user_id, action, ip_address, user_agent, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        uuidv4(),
        senderId,
        'request_money',
        ip_address,
        user_agent,
        `Demande ${amount} HTG à member:${recipientMemberId} (user:${recipientUserId})`,
      ]
    );

    await client.query('COMMIT');
    return res.status(200).json({
      message: 'Demande d’argent enregistrée avec succès.',
      transactionId,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur createRequest :', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la demande.' });
  } finally {
    client.release();
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
