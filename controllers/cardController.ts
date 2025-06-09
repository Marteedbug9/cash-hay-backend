import { Request, Response } from 'express';
import pool from '../config/db';

// 🟢 Demande de carte gratuite, paiement après 48h
export const requestCard = async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const userId = req.user?.id;

    // Vérifie si l'utilisateur a déjà une carte active ou en attente
    const existingCard = await client.query(
      'SELECT * FROM cards WHERE user_id = $1 AND status IN ($2, $3)',
      [userId, 'pending', 'active']
    );

    if (existingCard.rows.length > 0) {
      return res.status(400).json({ error: "Vous avez déjà une carte active ou en attente." });
    }

    // Enregistrement de la carte gratuite, le paiement sera différé
    await client.query(
      'INSERT INTO cards (user_id, status, is_locked, requested_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
      [userId, 'pending', false]
    );

    return res.json({
      message: "Carte demandée gratuitement. 25 HTG seront débités après 48h si elle est toujours active.",
    });
  } catch (err) {
    console.error('Erreur lors de la demande de carte :', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
};

// 🔒 Verrouiller/déverrouiller la carte
export const toggleCardLock = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { is_locked } = req.body;

  await pool.query('UPDATE cards SET is_locked = $1 WHERE user_id = $2', [is_locked, userId]);
  return res.json({ message: `Carte ${is_locked ? 'verrouillée' : 'déverrouillée'}` });
};

// ❌ Annuler la carte
export const cancelCard = async (req: Request, res: Response) => {
  const userId = req.user?.id;

  await pool.query('DELETE FROM cards WHERE user_id = $1', [userId]);
  return res.json({ message: 'Carte annulée' });
};