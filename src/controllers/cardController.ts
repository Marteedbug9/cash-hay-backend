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

    // Enregistrement de la carte gratuite, paiement différé
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

  // Sécurité: vérifie que la carte existe d'abord (optionnel)
  const { rows: cards } = await pool.query(
    'SELECT * FROM cards WHERE user_id = $1 AND status IN ($2, $3)',
    [userId, 'active', 'pending']
  );
  if (cards.length === 0) {
    return res.status(404).json({ error: "Aucune carte à verrouiller/déverrouiller." });
  }

  await pool.query(
    'UPDATE cards SET is_locked = $1 WHERE user_id = $2 AND status IN ($3, $4)',
    [is_locked, userId, 'active', 'pending']
  );
  return res.json({ message: `Carte ${is_locked ? 'verrouillée' : 'déverrouillée'}` });
};

// ❌ Annuler la carte (ne supprime pas !)
// Seul un agent Cash Hay peut supprimer définitivement après audit, sinon on la “lock” et “cancel”
export const cancelCard = async (req: Request, res: Response) => {
  const userId = req.user?.id;

  // Sécurité: la carte doit exister, et être dans un statut annulable
  const { rows: cards } = await pool.query(
    'SELECT * FROM cards WHERE user_id = $1 AND status IN ($2, $3)',
    [userId, 'active', 'pending']
  );
  if (cards.length === 0) {
    return res.status(404).json({ error: "Aucune carte active à annuler." });
  }

  // On met à jour le statut et on verrouille, mais on NE SUPPRIME PAS
  await pool.query(
    'UPDATE cards SET status = $1, is_locked = $2 WHERE user_id = $3 AND status IN ($4, $5)',
    ['cancelled', true, userId, 'active', 'pending']
  );

  return res.json({ message: 'Carte annulée. Un agent validera l’annulation si nécessaire.' });
};

export const requestPhysicalCard = async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const userId = req.user?.id;

    // Vérifie si déjà une carte physique en cours
    const { rows: existingPhysical } = await client.query(
      'SELECT * FROM cards WHERE user_id = $1 AND type = $2 AND status IN ($3, $4)',
      [userId, 'physical', 'pending', 'active']
    );
    if (existingPhysical.length > 0) {
      return res.status(400).json({ error: "Vous avez déjà une carte physique en cours ou active." });
    }

    // Insère la demande de carte physique (status = pending)
    await client.query(
      `INSERT INTO cards (user_id, type, status, is_locked, requested_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
      [userId, 'physical', 'pending', false]
    );

    return res.json({ message: "Demande de carte physique enregistrée. Vous serez notifié lors de la validation." });
  } catch (err) {
    console.error('Erreur demande carte physique:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
};

