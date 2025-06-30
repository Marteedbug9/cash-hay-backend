import { Request, Response } from 'express';
import pool from '../config/db';
import { sendPushNotification, sendEmail, sendSMS } from '../utils/notificationUtils';
import { v4 as uuidv4 } from 'uuid';


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

  // Récupère la dernière carte physique en cours/pending
  const { rows: cards } = await pool.query(
    `SELECT * FROM cards 
     WHERE user_id = $1 
       AND category = 'physique' selon ta structure
       AND status IN ('active', 'pending')
     ORDER BY requested_at DESC
     LIMIT 1`,
    [userId]
  );

  if (cards.length === 0) {
    return res.status(404).json({ error: "Aucune carte physique à annuler." });
  }

  const cardId = cards[0].id;

  // Mets à jour le statut et verrouille la carte physique trouvée
  await pool.query(
    `UPDATE cards 
     SET status = 'cancelled', is_locked = true 
     WHERE id = $1`,
    [cardId]
  );

  // Ajoute un audit log
  await pool.query(
    `INSERT INTO audit_logs (user_id, action, details, created_at) 
     VALUES ($1, $2, $3, NOW())`,
    [userId, 'cancel_card', `Carte physique ID ${cardId} annulée par utilisateur`]
  );

  return res.json({ message: 'Carte physique annulée. Un agent validera l’annulation si nécessaire.' });
};



export const requestPhysicalCard = async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const userId = req.user?.id;
    // Le frontend doit envoyer :
    // style_id, price, design_url, label, card_name, is_custom (optionnel), type (classic/metal), etc.
    const {
      style_id,
      price,
      label,
      card_name,
      design_url,
      is_custom = false,
      category = 'physique',
      type = 'classic',
    } = req.body;

    const transferFee = 0.57;
    const ip_address = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    const user_agent = req.headers['user-agent'] || '';
    const adminId = process.env.ADMIN_USER_ID || 'admin-id-123';

    // 1️⃣ Vérifie le modèle (pour une carte standard, tu veux récupérer son prix dans card_types ; pour custom, le prix est envoyé)
    let truePrice = Number(price);
    if (!is_custom) {
      // On check la table card_types si la carte n'est pas custom :
      const { rows: cardTypeRows } = await client.query(
        'SELECT price, image_url FROM card_types WHERE type = $1',
        [style_id]
      );
      if (!cardTypeRows.length) {
        return res.status(404).json({ error: "Modèle de carte introuvable. Vérifiez le style_id envoyé." });
      }
      truePrice = Number(cardTypeRows[0].price);
    }

    // 2️⃣ Vérifie la balance
    const { rows: balanceRows } = await client.query(
      'SELECT amount FROM balances WHERE user_id = $1',
      [userId]
    );
    const balance = Number(balanceRows[0]?.amount || 0);

    if (balance < truePrice + transferFee) {
      return res.status(400).json({ error: "Solde insuffisant pour demander ce modèle de carte (frais inclus)." });
    }

    // 3️⃣ Déduire la balance utilisateur (prix + frais)
    await client.query(
      'UPDATE balances SET amount = amount - $1 WHERE user_id = $2',
      [truePrice + transferFee, userId]
    );

    // 4️⃣ Transaction pour la carte
    await client.query(
      `INSERT INTO transactions (id, user_id, type, amount, status, description, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [uuidv4(), userId, 'card_fee', truePrice, 'completed', `Frais pour carte ${label || style_id}`]
    );

    // 5️⃣ Frais de service pour admin
    await client.query(
      'UPDATE balances SET amount = amount + $1 WHERE user_id = $2',
      [transferFee, adminId]
    );
    await client.query(
      `INSERT INTO transactions (id, user_id, type, amount, currency, recipient_id, source, status, description, ip_address, user_agent, created_at)
       VALUES ($1, $2, 'fee', $3, 'HTG', $4, 'fee', 'completed', 'Frais de transfert carte', $5, $6, NOW())`,
      [uuidv4(), userId, transferFee, adminId, ip_address, user_agent]
    );

    // 6️⃣ Insère la demande de carte physique
    await client.query(
      `INSERT INTO user_cards (user_id, style_id, type, price, category, is_current, design_url, label,status)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7,$8)`,
      [
        userId,
        style_id,
        type,
        truePrice,
        category,
        design_url || null,
        label || card_name || '', // label pour retrouver la carte plus facilement
        'pending',
      ]
    );

    // 7️⃣ Envoi d’email confirmation utilisateur
    const { rows: userRows } = await client.query(
      `SELECT email, first_name FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    const email = userRows[0]?.email;
    const prenom = userRows[0]?.first_name || '';

    if (email) {
      await sendEmail({
        to: email,
        subject: "Votre demande de carte physique Cash Hay a été reçue !",
        text: `Bonjour ${prenom || ''},

Votre demande de carte physique Cash Hay a bien été reçue.
Nous allons la traiter dans les plus brefs délais.
Vous recevrez une notification dès qu’elle sera validée et prête à être imprimée.

Merci de votre confiance.
L’équipe Cash Hay`
      });
    }

    return res.json({
      message: "Demande de carte enregistrée. Frais prélevés et commission admin prise en compte. Un email de confirmation a été envoyé."
    });

  } catch (err: any) {
    if (
      err.code === '23503' &&
      err.detail &&
      err.detail.includes('is not present in table "card_types"')
    ) {
      return res.status(400).json({ error: "Le modèle de carte sélectionné n'existe pas dans card_types. Contactez le support." });
    }
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
    // 1️⃣ Vérifie si le modèle existe déjà dans card_types
    const { rows } = await pool.query(
      `SELECT * FROM card_types WHERE type = $1`,
      [style_id]
    );

    // 2️⃣ Si le style_id n’existe pas, l’ajoute (on garde le design_url comme image du modèle custom)
    if (rows.length === 0) {
      await pool.query(
        `INSERT INTO card_types (type, label, price, image_url)
         VALUES ($1, $2, $3, $4)`,
        [
          style_id,
          label,
          price,
          design_url // image du modèle = design personnalisé
        ]
      );
    } else if (!rows[0].image_url && design_url) {
      // Si le modèle existe mais sans image, on complète automatiquement
      await pool.query(
        `UPDATE card_types SET image_url = $1 WHERE type = $2`,
        [design_url, style_id]
      );
    }

    // 3️⃣ Insère dans user_cards (conformément à la contrainte FK)
    await pool.query(
  `INSERT INTO user_cards 
    (user_id, style_id, type, category, price, design_url, label, is_current, status) 
   VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)`,
  [userId, style_id, type, 'physique', price, design_url, label, 'pending']
);


    res.status(201).json({ message: 'Carte personnalisée enregistrée avec succès.' });
  } catch (err: any) {
    // Gestion de l’erreur FK si bug côté style_id
    if (
      err.code === '23503' &&
      err.detail &&
      err.detail.includes('is not present in table "card_types"')
    ) {
      return res.status(400).json({ error: "Erreur FK: Le modèle de carte n'existe pas dans card_types." });
    }
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

  if (!style_id || !label || !price || !design_url) {
    return res.status(400).json({ error: 'Champs manquants (style_id, label, price, design_url requis).' });
  }

  try {
    // 1️⃣ Vérifie si le modèle existe dans card_types
    const { rows } = await pool.query(
      'SELECT * FROM card_types WHERE type = $1',
      [style_id]
    );

    // 2️⃣ Si pas trouvé → insère dans card_types
    if (rows.length === 0) {
      await pool.query(
        `INSERT INTO card_types (type, label, price, image_url)
         VALUES ($1, $2, $3, $4)`,
        [
          style_id,
          label,
          price,
          design_url // L’image du modèle pour ce style_id
        ]
      );
    }

    // 3️⃣ Insère dans user_cards
    await pool.query(
      `INSERT INTO user_cards 
        (user_id, style_id, type, price, design_url, label, category, is_current)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
      [
        userId,
        style_id,
        is_custom ? 'custom' : 'classic', // ou metal, etc.
        price,
        design_url,
        label,
        'physique',
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
      `SELECT *
       FROM user_cards
       WHERE user_id = $1
         AND design_url IS NOT NULL
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
    // Vérifie qu'aucune carte physique n'est déjà en attente ou active
    const { rows: existing } = await pool.query(
      `SELECT * FROM user_cards WHERE user_id = $1 AND category = 'physique' AND is_current = true`,
      [userId]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: "Une carte physique est déjà en cours ou active." });
    }

    // Stocke la demande personnalisée pour admin (type = classic ou metal selon ton frontend, ici custom pour différencier)
    await pool.query(
      `INSERT INTO user_cards 
        (user_id, design_url, type, style_id, price, status, category, is_current, label) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)`,
      [
        userId,
        design_url,
        'custom',          // type: custom, classic ou metal
        'custom',          // style_id: custom (ou autre id si tu veux)
        0,                 // price: à ajuster si nécessaire
        'pending',         // status: la carte attend validation
        'physique',        // category: physique, car c'est une demande physique
        'Carte personnalisée', // label par défaut
      ]
    );

    res.json({ message: "Demande personnalisée enregistrée." });
  } catch (err) {
    console.error("❌ Erreur enregistrement carte:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};


