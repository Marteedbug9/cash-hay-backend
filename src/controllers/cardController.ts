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

  // 🔥 Ici tu ajoutes ton audit log
  await pool.query(
    'INSERT INTO audit_logs (user_id, action, details, created_at) VALUES ($1, $2, $3, NOW())',
    [userId, 'cancel_card', 'Carte annulée par utilisateur']
  );

  return res.json({ message: 'Carte annulée. Un agent validera l’annulation si nécessaire.' });
};


export const requestPhysicalCard = async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const userId = req.user?.id;

    // Vérifie si l'utilisateur est autorisé
    const { rows: userRows } = await client.query(
      'SELECT card_request_allowed FROM users WHERE id = $1',
      [userId]
    );

    if (!userRows[0]?.card_request_allowed) {
      return res.status(403).json({ error: "Vous n’êtes pas autorisé à faire une nouvelle demande de carte. Contactez un administrateur." });
    }

    // Vérifie si déjà une carte physique "classique" en cours ou active
    const { rows: existingPhysical } = await client.query(
      'SELECT * FROM cards WHERE user_id = $1 AND type = $2 AND status IN ($3, $4)',
      [userId, 'physical', 'pending', 'active']
    );
    if (existingPhysical.length > 0) {
      return res.status(400).json({ error: "Vous avez déjà une carte physique en cours ou active." });
    }

    // 🔒 Vérifie si déjà une carte personnalisée physique produite/assignée
    const { rows: existingCustomPhysical } = await client.query(
      `SELECT * FROM user_cards WHERE user_id = $1 AND type = $2 AND design_url IS NOT NULL AND card_id IS NOT NULL`,
      [userId, 'physical']
    );
    if (existingCustomPhysical.length > 0) {
      return res.status(400).json({ error: "Vous avez déjà une carte physique personnalisée produite ou en cours." });
    }

    // Insère la demande de carte physique
    await client.query(
      `INSERT INTO cards (user_id, type, status, is_locked, requested_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
      [userId, 'physical', 'pending', false]
    );

    // Bloque les futures demandes jusqu'à validation
    await client.query(
      'UPDATE users SET card_request_allowed = false WHERE id = $1',
      [userId]
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
  const { style_id, type, price, design_url, label, card_name } = req.body;

  if (!style_id || !type || !price || !design_url || !label)
    return res.status(400).json({ error: 'Champs manquants.' });

  try {
    await pool.query(
      `INSERT INTO user_cards 
        (user_id, style_id, type, price, design_url, label, is_current) 
       VALUES ($1, $2, $3, $4, $5, $6, true)`,
      [userId, style_id, type, price, design_url, label]
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
      `SELECT 
         uc.*, 
         ct.label AS card_label,
         ct.price AS default_price,
         c.status AS card_status,
         c.is_locked,
         c.card_number,
         c.expiry_date
       FROM user_cards uc
       LEFT JOIN card_types ct ON uc.style_id = ct.type
       LEFT JOIN cards c ON uc.card_id = c.id
       WHERE uc.user_id = $1
       ORDER BY uc.created_at DESC`,
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
  const { style_id, label, price, design_url, is_custom } = req.body;

  // Champs obligatoires
  if (!style_id || !label || !price || !design_url) {
    return res.status(400).json({ error: 'Champs manquants (style_id, label, price, design_url requis).' });
  }

  try {
    await pool.query(
      `INSERT INTO user_cards (user_id, style_id, type, price, design_url, label, is_current)
       VALUES ($1, $2, $3, $4, $5, $6, true)`,
      [
        userId,
        style_id,
        is_custom ? 'custom' : 'classic',
        price,
        design_url,   // toujours défini
        label,
      ]
    );
    res.json({ message: 'Carte enregistrée avec succès.' });
  } catch (err) {
    console.error('❌ Erreur enregistrement carte :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
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


export const hasCard = async (req: Request, res: Response) => {
  const userId = req.user?.id;

  try {
    const { rows } = await pool.query(
      `SELECT id FROM user_cards WHERE user_id = $1 LIMIT 1`,
      [userId]
    );

    res.json({ hasCard: rows.length > 0 });
  } catch (err) {
    console.error('❌ Erreur vérification carte:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

export const requestPhysicalCustomCard = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { design_url } = req.body;

  if (!design_url) {
    return res.status(400).json({ error: "URL de design manquante." });
  }

  try {
    const { rows: existing } = await pool.query(
      `SELECT * FROM cards WHERE user_id = $1 AND type = 'physical' AND status IN ('pending', 'active')`,
      [userId]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: "Une carte physique est déjà en cours ou active." });
    }

    // Stocke dans `user_cards` pour que l’admin voie la personnalisation
    await pool.query(
      `INSERT INTO user_cards (user_id, design_url, type, style_id, price, status)
       VALUES ($1, $2, 'physical', 'custom', 0, 'pending')`,
      [userId, design_url]
    );

    res.json({ message: "Demande personnalisée enregistrée." });
  } catch (err) {
    console.error("❌ Erreur enregistrement carte:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

// POST /api/cards/select-model

