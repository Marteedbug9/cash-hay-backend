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


export const saveCustomCard = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { style_id, type, price, design_url } = req.body;

  if (!style_id || !type || !price || !design_url)
    return res.status(400).json({ error: 'Champs manquants.' });

  try {
    await pool.query(
      `INSERT INTO user_cards (user_id, style_id, type, price, design_url)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, style_id, type, price, design_url]
    );
    res.status(201).json({ message: 'Carte enregistrée avec succès.' });
  } catch (err) {
    console.error('❌ Erreur insertion carte personnalisée:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};


export const getUserCards = async (req: Request, res: Response) => {
  const userId = req.user?.id;

  try {
    const result = await pool.query(
      `SELECT * FROM user_cards WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    res.json({ cards: result.rows });
  } catch (err) {
    console.error('❌ Erreur récupération cartes:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};


export const getCurrentCard = async (req: Request, res: Response) => {
  const userId = req.user?.id;

  try {
    const { rows: cards } = await pool.query(
      `SELECT * FROM cards WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 1`,
      [userId]
    );

    const { rows: custom } = await pool.query(
      `SELECT * FROM user_cards WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    return res.json({
      card: cards[0] || null,
      custom: custom[0] || null,
    });
  } catch (err) {
    console.error('❌ Erreur récupération carte:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};


export const activateCard = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { cvc } = req.body;

  if (!cvc || cvc.length !== 3) {
    return res.status(400).json({ error: 'Code CVC invalide' });
  }

  try {
    const result = await pool.query(
      `UPDATE cards SET status = $1, activated_at = NOW() WHERE user_id = $2 AND status = $3`,
      ['active', userId, 'pending']
    );

    if (result.rowCount === 0) {
      return res.status(400).json({ error: "Aucune carte à activer." });
    }

    return res.json({ message: 'Carte activée avec succès' });
  } catch (err) {
    console.error('❌ Erreur activation carte:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};


export const selectCardModel = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { card_name, is_custom, design_url, style_id, price } = req.body;

  if (!card_name) return res.status(400).json({ error: 'Nom de carte requis.' });

  try {
    if (is_custom) {
      // Enregistrement d'une carte personnalisée
      if (!design_url || !style_id || !price) {
        return res.status(400).json({ error: 'Détails de personnalisation manquants.' });
      }

      await pool.query(
        `INSERT INTO user_cards (user_id, style_id, type, price, design_url, label)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, style_id, 'custom', price, design_url, card_name]
      );
    } else {
      // Enregistrement d'une sélection de modèle simple
      await pool.query(
        `INSERT INTO user_cards (user_id, style_id, type, price, design_url, label)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, style_id || null, 'classic', price || 0, null, card_name]
      );
    }

    return res.json({ message: 'Carte enregistrée avec succès.' });
  } catch (err) {
    console.error('❌ Erreur enregistrement carte :', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};


export const getLatestCustomCard = async (req: Request, res: Response) => {
  const userId = req.user?.id;

  try {
    const result = await pool.query(
      `SELECT * FROM user_cards 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Aucune carte personnalisée trouvée.' });
    }

    res.status(200).json({ card: result.rows[0] });
  } catch (err) {
    console.error('❌ Erreur récupération carte personnalisée:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};


export const assignPhysicalCard = async (req: Request, res: Response) => {
  const { userId, card_number, expiry_date, cvv } = req.body;

  if (!userId || !card_number || !expiry_date || !cvv) {
    return res.status(400).json({ error: 'Champs requis manquants.' });
  }

  try {
    await pool.query(
      `INSERT INTO cards (user_id, card_number, expiry_date, cvv, type, account_type, status, is_locked, created_at)
       VALUES ($1, $2, $3, $4, 'physique', 'debit', 'active', false, NOW())`,
      [userId, card_number, expiry_date, cvv]
    );

    res.status(201).json({ message: 'Carte physique assignée avec succès.' });
  } catch (err) {
    console.error('❌ Erreur assignation carte physique:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};
