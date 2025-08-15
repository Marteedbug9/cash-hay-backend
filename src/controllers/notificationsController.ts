// src/controllers/notificationsController.ts
import { Request, Response } from 'express';
import pool from '../config/db';
import { v4 as uuidv4 } from 'uuid';
import {
  encrypt,
  decryptNullable,
  blindIndexEmail,
  blindIndexPhone,
} from '../utils/crypto';

type NotificationType = 'request' | 'receive' | 'cancel';
type NotificationStatus = 'pending' | 'accepted' | 'cancelled';

// Détecte si le contact ressemble à un email ou à un téléphone (très simple)
function isEmail(contact: string) {
  return /\S+@\S+\.\S+/.test(contact);
}
function isPhone(contact: string) {
  // adapte au format Haïti si besoin
  return /^[0-9+\-\s()]{6,}$/.test(contact);
}

// ✅ Ajouter une notification (avec colonnes chiffrées)
export const addNotification = async ({
  user_id,
  type,
  from_first_name,
  from_last_name,
  from_contact,
  from_profile_image,
  amount,
  status,
  transaction_id,
}: {
  user_id: string;
  type: NotificationType;
  from_first_name: string;
  from_last_name: string;
  from_contact: string;        // email ou téléphone
  from_profile_image: string;  // URL (on chiffre aussi pour homogénéité)
  amount: number;              // stocké en clair (HTG)
  status: NotificationStatus;
  transaction_id?: string;
}) => {
  const id = uuidv4();

  // chiffrement
  const firstEnc = encrypt(from_first_name);
  const lastEnc = encrypt(from_last_name);
  const contactEnc = encrypt(from_contact);
  const profileEnc = encrypt(from_profile_image);

  // blind index selon le type de contact
  const emailBidx =
    isEmail(from_contact) ? blindIndexEmail(from_contact) : null;
  const phoneBidx =
    isPhone(from_contact) ? blindIndexPhone(from_contact) : null;

  await pool.query(
  `
    INSERT INTO notifications (
      id,
      user_id, type,
      -- legacy plain
      from_first_name, from_last_name, from_contact, from_profile_image,
      -- encrypted + bidx
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
    id,
    user_id, type,
    // legacy
    from_first_name, from_last_name, from_contact, from_profile_image,
    // enc + bidx
    firstEnc, lastEnc, contactEnc, emailBidx, phoneBidx, profileEnc,
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
    // détecte la présence des colonnes enc
    const check = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='notifications' AND column_name='from_first_name_enc'
      ) AS has_enc;
    `);
    const hasEnc = !!check.rows[0]?.has_enc;

    let rows;
    if (hasEnc) {
      const r = await pool.query(
        `
          SELECT id, type,
                 from_first_name_enc, from_last_name_enc, from_contact_enc, from_profile_image_enc,
                 amount, status, created_at
          FROM notifications
          WHERE user_id = $1
          ORDER BY created_at DESC
        `,
        [userId]
      );
      rows = r.rows.map((n) => ({
        id: n.id,
        type: n.type as 'request' | 'receive' | 'cancel',
        from_first_name: decryptNullable(n.from_first_name_enc) || '',
        from_last_name:  decryptNullable(n.from_last_name_enc)  || '',
        from_contact:    decryptNullable(n.from_contact_enc)     || '',
        from_profile_image: decryptNullable(n.from_profile_image_enc) || '',
        amount_htg: Number(n.amount),
        amount_label: `${Number(n.amount)} HTG`,
        status: n.status,
        created_at: n.created_at,
      }));
    } else {
      // 🟢 fallback legacy (aucun déchiffrement)
      const r = await pool.query(
        `
          SELECT id, type,
                 from_first_name, from_last_name, from_contact, from_profile_image,
                 amount, status, created_at
          FROM notifications
          WHERE user_id = $1
          ORDER BY created_at DESC
        `,
        [userId]
      );
      rows = r.rows.map((n) => ({
        id: n.id,
        type: n.type as 'request' | 'receive' | 'cancel',
        from_first_name: n.from_first_name || '',
        from_last_name:  n.from_last_name  || '',
        from_contact:    n.from_contact    || '',
        from_profile_image: n.from_profile_image || '',
        amount_htg: Number(n.amount),
        amount_label: `${Number(n.amount)} HTG`,
        status: n.status,
        created_at: n.created_at,
      }));
    }

    return res.json({ notifications: rows });
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
