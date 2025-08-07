import { Request, Response } from 'express';
import pool from '../config/db';
import { sendPushNotification, sendEmail, sendSMS } from '../utils/notificationUtils';
import { CardStatus, CardType, CardCategory, DEFAULT_CURRENCY,
  DEFAULT_SPENDING_LIMIT, } from '../constants/card';
import { v4 as uuidv4 } from 'uuid';
import stripe from '../config/stripe';
import Stripe from 'stripe';
import axios from 'axios';
import { MARQETA_API_BASE, MARQETA_APP_TOKEN, MARQETA_ADMIN_TOKEN } from '../webhooks/marqeta';


const MARQETA_AUTH = {
  username: MARQETA_APP_TOKEN!,
  password: MARQETA_ADMIN_TOKEN!,
};


interface CustomCardRequest {
  design_url: string;
  card_type?: 'classic' | 'metal' | 'custom';
  label?: string;
}

interface RequestVirtualCardBody {
  phone?: string;
  email?: string;
}



// 🟢 Demande de carte gratuite, paiement après 48h

export const requestVirtualCard = async (req: Request<{}, {}, RequestVirtualCardBody>, res: Response) => {
  const client = await pool.connect();
  try {
    // 1. Vérification de l'authentification
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Authentification requise' });
    }

    const userId = req.user.id;
    const { phone, email } = req.body;

    // 2. Récupération des données utilisateur
    const userQuery = await client.query(
      'SELECT first_name, last_name, city, zip_code, address FROM users WHERE id = $1',
      [userId]
    );
    
    if (userQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const user = userQuery.rows[0];
    const fullName = `${user.first_name} ${user.last_name}`;

    // 3. Création du titulaire de carte Stripe
    const cardholder = await stripe.issuing.cardholders.create({
      name: fullName,
      email: email || req.user.email,
      phone_number: phone || req.user.phone,
      status: 'active',
      type: 'individual',
      billing: {
        address: {
          line1: user.address || 'N/A',
          city: user.city || 'Port-au-Prince',
          postal_code: user.zip_code || '9999',
          country: 'HT',
          state: '',
        },
      },
    });

    // 4. Création de la carte virtuelle avec catégories directement définies
   const card = await stripe.issuing.cards.create({
  cardholder: cardholder.id,
  type: 'virtual' as Stripe.Issuing.CardCreateParams.Type,
  currency: DEFAULT_CURRENCY,
  status: 'active' as Stripe.Issuing.CardCreateParams.Status,
  spending_controls: {
    spending_limits: [{
      amount: DEFAULT_SPENDING_LIMIT,
      interval: 'daily'
    }],
    allowed_categories: ['financial_institutions']
  }
});

await client.query(
  `INSERT INTO cards (
    user_id, stripe_card_id, stripe_cardholder_id,
    status, type, last4, expiry_date,
    funding_currency, spending_controls, created_at, requested_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
  [
    userId,
    card.id,
    cardholder.id,
    CardStatus.ACTIVE,
    CardType.VIRTUAL,
    card.last4,
    `${card.exp_month}/${card.exp_year}`,
    DEFAULT_CURRENCY.toUpperCase(),
    JSON.stringify({
      daily_limit: DEFAULT_SPENDING_LIMIT,
      allowed_categories: ['atm', 'financial_institutions', 'restaurants']
    }),
  ]
);


    // 5. Enregistrement en base de données
    await client.query(
      `INSERT INTO cards (
        user_id, stripe_card_id, stripe_cardholder_id,
        status, type, last4, expiry_date,
        funding_currency, spending_controls, created_at, requested_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
      [
        userId,
        card.id,
        cardholder.id,
        'active',
        'virtual',
        card.last4,
        `${card.exp_month}/${card.exp_year}`,
        'USD',
        JSON.stringify({
          daily_limit: 5000,
          allowed_categories: ['atm', 'financial_institutions', 'restaurants'] // Répétition acceptable car simple
        }),
      ]
    );

    // 6. Réponse
    res.json({
      success: true,
      card: {
        id: card.id,
        last4: card.last4,
        expiry: `${card.exp_month}/${card.exp_year}`,
        status: 'active',
        daily_limit: 5000,
        currency: 'usd'
      }
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur création carte:', err);
    res.status(500).json({ 
      error: 'Échec de la création de la carte',
      details: err instanceof Error ? err.message : 'Erreur inconnue'
    });
  } finally {
    client.release();
  }
};
// 🔒 Verrouiller/déverrouiller la carte
export const toggleCardLock = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { is_locked } = req.body;

  // 1. Trouve la carte active du user
  const { rows: cards } = await pool.query(
    'SELECT * FROM cards WHERE user_id = $1 AND status IN ($2, $3) LIMIT 1',
    [userId, 'active', 'pending']
  );
  if (cards.length === 0) {
    return res.status(404).json({ error: "Aucune carte à verrouiller/déverrouiller." });
  }
  const card = cards[0];

  // Vérifie que stripe_card_id existe
  if (!card.stripe_card_id) {
    return res.status(400).json({ error: "Aucun stripe_card_id associé à cette carte." });
  }

  try {
    // 2. MAJ Stripe : 'inactive' pour lock, 'active' pour unlock
    const newStatus = is_locked ? 'inactive' : 'active';

    await stripe.issuing.cards.update(card.stripe_card_id, {
      status: newStatus
    });

    // 3. MAJ base locale
    await pool.query(
      `UPDATE cards
         SET is_locked = $1,
             status = $2,
             updated_at = NOW()
       WHERE id = $3`,
      [is_locked, newStatus, card.id]
    );

    return res.json({ message: `Carte ${is_locked ? 'verrouillée' : 'déverrouillée'} avec succès.` });
  } catch (err) {
    console.error('Erreur Stripe lors du lock:', err);
    return res.status(500).json({ error: "Erreur Stripe lors du changement de statut de la carte." });
  }
};


// ❌ Annuler la carte (ne supprime pas !)
// Seul un agent Cash Hay peut supprimer définitivement après audit, sinon on la “lock” et “cancel”
export const cancelCard = async (req: Request, res: Response) => {
  const userId = req.user?.id;

  // 1. Cherche la dernière carte physique active/pending
  const { rows: cards } = await pool.query(
    `SELECT * FROM cards 
     WHERE user_id = $1 
       AND category = 'physique'
       AND status IN ('active', 'pending')
     ORDER BY requested_at DESC
     LIMIT 1`,
    [userId]
  );

  if (cards.length === 0) {
    return res.status(404).json({ error: "Aucune carte physique à annuler." });
  }

  const card = cards[0];

  // 2. Mets à jour le statut local : "pending_cancel" (pas encore annulée Stripe)
  await pool.query(
    `UPDATE cards 
     SET status = 'pending_cancel', is_locked = true, updated_at = NOW() 
     WHERE id = $1`,
    [card.id]
  );

  // 3. Audit log
  await pool.query(
    `INSERT INTO audit_logs (user_id, action, details, created_at) 
     VALUES ($1, $2, $3, NOW())`,
    [userId, 'request_cancel_card', `Demande d’annulation carte physique ID ${card.id}`]
  );

  return res.json({ message: 'Demande d’annulation enregistrée. Un agent validera la suppression de la carte.' });
};


export const requestPhysicalCard = async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    // 1. Vérification de l'authentification
    if (!req.user?.id || !req.user.first_name || !req.user.last_name) {
      return res.status(401).json({ error: 'Informations utilisateur incomplètes' });
    }

    const { cardholderId, shippingAddress } = req.body;

    // 2. Création de la carte physique
    const card = await stripe.issuing.cards.create({
      type: 'physical',
      cardholder: cardholderId,
      currency: 'usd', // Champ requis ajouté
      status: 'inactive',
      shipping: {
        name: `${req.user.first_name} ${req.user.last_name}`,
        address: {
          line1: shippingAddress?.line1 || 'N/A',
          city: shippingAddress?.city || 'Port-au-Prince',
          postal_code: shippingAddress?.postal_code || '9999',
          country: 'HT',
          state: '',
        },
      },
    });

    // 3. Enregistrement en base de données
    await client.query(
      `INSERT INTO cards (
        user_id, stripe_card_id, stripe_cardholder_id,
        status, type, last4, expiry_date,
        funding_currency, created_at, requested_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
      [
        req.user.id,
        card.id,
        cardholderId,
        'inactive',
        'physical',
        card.last4,
        `${card.exp_month}/${card.exp_year}`,
        'USD'
      ]
    );

    res.json({ 
      success: true, 
      cardId: card.id 
    });

  } catch (err) {
    console.error('Erreur création carte physique:', err);
    res.status(500).json({ 
      error: 'Échec de la création de la carte physique',
      details: err instanceof Error ? err.message : 'Erreur inconnue'
    });
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

  if (!cvc || typeof cvc !== 'string' || cvc.length !== 3) {
    return res.status(400).json({ error: 'Code CVC invalide' });
  }

  try {
    // 1️⃣ Vérifier si une carte physique PENDING existe
    const result = await pool.query(
      `SELECT * FROM cards WHERE user_id = $1 AND type = $2 AND status = $3 LIMIT 1`,
      [userId, CardType.PHYSICAL, CardStatus.PENDING]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Aucune carte physique en attente trouvée.' });
    }

    const card = result.rows[0];

    // 2️⃣ Appel à Marqeta pour activer la carte
    const marqetaRes = await axios.put(
      `${MARQETA_API_BASE}/cards/${card.marqeta_token}`,
      {
        state: 'ACTIVE', // Uppercase pour Marqeta
        // activation: { cvc }, // ⚠️ facultatif, utilisé si Marqeta le demande
      },
      {
        auth: {
          username: MARQETA_APP_TOKEN,
          password: MARQETA_ADMIN_TOKEN,
        },
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    // 3️⃣ Mettre à jour la base locale
    await pool.query(
      `UPDATE cards SET status = $1, activated_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [CardStatus.ACTIVE, card.id]
    );

    res.json({ message: 'Carte physique activée avec succès.', marqeta: marqetaRes.data });
  } catch (err: any) {
    console.error('❌ Erreur activation carte physique :', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || 'Erreur serveur' });
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
  const { userId, card_number, expiry_date } = req.body;

  if (!userId || !card_number || !expiry_date ) {
    return res.status(400).json({ error: 'Champs requis manquants.' });
  }

  try {
    await pool.query(
      `INSERT INTO cards (user_id, card_number, expiry_date, type, account_type, status, is_locked, created_at)
       VALUES ($1, $2, $3, $4, 'physique', 'debit', 'active', false, NOW())`,
      [userId, card_number, expiry_date]
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

export const requestPhysicalCustomCard = async (req: Request & { user?: { id: string } }, res: Response) => {
  const userId = req.user?.id;
  const { design_url, card_type = 'custom', label = 'Carte personnalisée' }: CustomCardRequest = req.body;

  // Validation des entrées
  if (!userId) {
    return res.status(401).json({ error: "Authentification requise." });
  }

  if (!design_url) {
    return res.status(400).json({ 
      error: "URL de design manquante.",
      details: "Le champ design_url est obligatoire pour une carte personnalisée"
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Vérification des cartes existantes
    const existingCards = await client.query(
      `SELECT id FROM user_cards 
       WHERE user_id = $1 AND category = 'physique' AND is_current = true
       AND status IN ('pending', 'active')`,
      [userId]
    );

    if (existingCards.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: "Demande de carte déjà en cours",
        details: "Vous avez déjà une carte physique en attente ou active"
      });
    }

    // 2. Enregistrement de la demande
    const result = await client.query(
      `INSERT INTO user_cards (
        user_id, design_url, type, style_id, 
        price, status, category, is_current, label
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, created_at`,
      [
        userId,
        design_url,
        card_type,
        'custom', // style_id
        0, // price - à adapter selon votre logique métier
        'pending', // status
        'physique',
        true,
        label
      ]
    );

    // 3. Audit log
    await client.query(
      `INSERT INTO audit_logs (user_id, action, details)
       VALUES ($1, $2, $3)`,
      [
        userId,
        'custom_card_request',
        `Nouvelle demande carte physique personnalisée (ID: ${result.rows[0].id})`
      ]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: "Demande de carte personnalisée enregistrée avec succès.",
      card_request: {
        id: result.rows[0].id,
        created_at: result.rows[0].created_at,
        status: 'pending'
      }
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Erreur enregistrement carte personnalisée:", err);
    
    const errorMessage = err instanceof Error ? err.message : "Erreur inconnue";
    res.status(500).json({ 
      error: "Échec de la demande de carte",
      details: errorMessage
    });
  } finally {
    client.release();
  }
};



