// src/controllers/notificationsController.ts
import { Request, Response } from 'express';
import pool from '../config/db';
import { v4 as uuidv4 } from 'uuid';
import {
  encrypt,
  decryptNullable,
  encryptNullable, 
  blindIndexEmail,
  blindIndexPhone,
} from '../utils/crypto';

type NotificationType = 'request' | 'receive' | 'cancel';
type NotificationStatus = 'pending' | 'accepted' | 'cancelled';


// helpers
const normalizeEmail = (s: string) => String(s).trim().toLowerCase();
const normalizePhone = (s: string) => String(s).replace(/\D/g, '');

function looksLikeEmail(s: string) {
  return /\S+@\S+\.\S+/.test(s);
}
function looksLikePhone(s: string) {
  return /^[0-9+\-\s()]{6,}$/.test(s);
}


// ✅ Ajouter une notification (avec colonnes chiffrées)
export const addNotification = async (args: {
  user_id: string;
  type: 'request' | 'receive' | 'cancel';
  from_first_name: string;
  from_last_name: string;
  from_contact: string;
  from_profile_image: string;
  amount: number;
  status: 'pending' | 'accepted' | 'cancelled';
  transaction_id?: string;
}) => {
  const {
    user_id, type,
    from_first_name, from_last_name,
    from_contact, from_profile_image,
    amount, status, transaction_id
  } = args;

  const id = uuidv4();

  const raw = String(from_contact || '');
  const emailNorm = looksLikeEmail(raw) ? normalizeEmail(raw) : null;
  const phoneNorm = looksLikePhone(raw) ? normalizePhone(raw) : null;

  const firstEnc   = encryptNullable(from_first_name);
  const lastEnc    = encryptNullable(from_last_name);
  const contactEnc = encryptNullable(from_contact);
  const profileEnc = encryptNullable(from_profile_image);

  const emailBidx = emailNorm ? blindIndexEmail(emailNorm) : null;
  const phoneBidx = phoneNorm ? blindIndexPhone(phoneNorm) : null;

  await pool.query(
    `
    INSERT INTO notifications (
      id, user_id, type,
      from_first_name, from_last_name, from_contact, from_profile_image,
      from_first_name_enc, from_last_name_enc, from_contact_enc,
      from_contact_email_bidx, from_contact_phone_bidx,
      from_profile_image_enc,
      amount, status, transaction_id, created_at
    )
    VALUES ($1,$2,$3,
            $4,$5,$6,$7,
            $8,$9,$10,$11,$12,$13,
            $14,$15,$16, NOW())
    `,
    [
      id, user_id, type,
      from_first_name, from_last_name, from_contact, from_profile_image,
      firstEnc, lastEnc, contactEnc,
      emailBidx, phoneBidx,
      profileEnc,
      amount, status, transaction_id || null,
    ]
  );

  return id;
};


// ✅ Récupérer toutes les notifications d’un utilisateur (en clair côté API)
// src/controllers/notificationsController.ts
export const getNotifications = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Utilisateur non authentifié.' });

  try {
    const { rows } = await pool.query(
      `
      SELECT
        id, type,
        from_first_name_enc, from_last_name_enc, from_contact_enc, from_profile_image_enc,
        from_first_name,     from_last_name,     from_contact,     from_profile_image,
        amount, status, created_at, transaction_id
      FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [userId]
    );

    const notifications = rows.map((n: any) => {
      const first   = decryptNullable(n.from_first_name_enc)    ?? n.from_first_name    ?? '';
      const last    = decryptNullable(n.from_last_name_enc)     ?? n.from_last_name     ?? '';
      const contact = decryptNullable(n.from_contact_enc)       ?? n.from_contact       ?? '';
      const photo   = decryptNullable(n.from_profile_image_enc) ?? n.from_profile_image ?? '';
      const amt     = Number(n.amount) || 0;

      return {
        id: n.id,
        type: n.type as 'request' | 'receive' | 'cancel',
        from_first_name: first,
        from_last_name:  last,
        from_contact:    contact,
        from_profile_image: photo,
        amount: amt,
        amount_htg: amt,
        amount_label: `${amt} HTG`,
        status: n.status as 'pending' | 'accepted' | 'cancelled',
        created_at: n.created_at,
        transaction_id: n.transaction_id || null,
      };
    });

    return res.json({ notifications });
  } catch (err) {
    console.error('❌ Erreur getNotifications :', err);
    return res.status(500).json({ error: 'Erreur serveur lors de la récupération des notifications.' });
  }
};


// ✅ Supprimer toutes les notifications pour un utilisateur
export const clearNotifications = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Utilisateur non authentifié.' });
  }

  try {
    await pool.query(`DELETE FROM notifications WHERE user_id = $1`, [userId]);
    res.json({ message: 'Notifications supprimées avec succès.' });
  } catch (err) {
    console.error('❌ Erreur clearNotifications :', err);
    res.status(500).json({ error: 'Erreur serveur lors de la suppression.' });
  }
};
