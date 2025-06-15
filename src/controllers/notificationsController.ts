import { Request, Response } from 'express';
import pool from '../config/db'; // Assure-toi que le pool est bien importé
import { v4 as uuidv4 } from 'uuid';


// ✅ Ajouter une notification
export const addNotification = async ({
  user_id,
  type,
  from_first_name,
  from_last_name,
  from_contact,
  from_profile_image,
  amount,
  status,
  transaction_id, // Optionnel, pour rattacher la notif à la bonne transaction
}: {
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
  await pool.query(
    `INSERT INTO notifications (
      id, user_id, type, from_first_name, from_last_name, from_contact, from_profile_image, amount, status, transaction_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      uuidv4(),
      user_id,
      type,
      from_first_name,
      from_last_name,
      from_contact,
      from_profile_image,
      amount,
      status,
      transaction_id || null,
    ]
  );
};


// ✅ Récupérer toutes les notifications d’un utilisateur
export const getNotifications = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Utilisateur non authentifié.' });
  }

  try {
    const result = await pool.query(
      `SELECT
        id,
        type,
        from_first_name,
        from_last_name,
        from_contact,
        from_profile_image,
        amount,
        status,
        created_at
      FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC`,
      [userId]
    );

    res.json({ notifications: result.rows });
  } catch (err) {
    console.error('❌ Erreur getNotifications :', err);
    res.status(500).json({ error: 'Erreur serveur lors de la récupération des notifications.' });
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