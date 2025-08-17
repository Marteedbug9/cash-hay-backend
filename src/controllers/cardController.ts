import { Request, Response } from 'express';
import pool from '../config/db';
import { CardStatus, CardType, CardCategory, DEFAULT_CURRENCY,
  DEFAULT_SPENDING_LIMIT, } from '../constants/card';
import axios from 'axios';
import { MARQETA_API_BASE, MARQETA_APP_TOKEN, MARQETA_ADMIN_TOKEN } from '../webhooks/marqeta';
import { createMarqetaCardholder, createVirtualCard } from '../webhooks/marqetaService';
// ⬆️ AJOUTER CES IMPORTS EN HAUT DU FICHIER (si pas déjà présents)
import sendEmail from '../utils/sendEmail';
import { buildCardRequestReceivedEmail } from '../templates/emails/cardRequestReceivedEmail';

import {
  encrypt,
  blindIndexEmail,
  blindIndexPhone,
  decryptNullable,
} from '../utils/crypto';

const MARQETA_AUTH = {
  username: MARQETA_APP_TOKEN!,
  password: MARQETA_ADMIN_TOKEN!,
};

// Helpers currency (HTG côté utilisateur)
const CURRENCY_USER = 'HTG';
const feeHtgEnv = Number(process.env.CARD_ISSUANCE_FEE_HTG ?? '0');
const fxHtgPerUsd = Number(process.env.FX_HTG_PER_USD ?? '0');

const toHTG = (usd: number) => {
  if (!fxHtgPerUsd || !isFinite(fxHtgPerUsd)) return 0;
  return Math.round(usd * fxHtgPerUsd);
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

const toUsd = (c: string) => c.toUpperCase();

// 🟢 Demande de carte gratuite, paiement après 48h

export const requestVirtualCard = async (
  req: Request<{}, {}, RequestVirtualCardBody>,
  res: Response
) => {
  const client = await pool.connect();
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Authentification requise' });
    const userId = req.user.id;

    // 1) Récupération utilisateur (depuis colonnes _enc)
    const u = await client.query(
      `SELECT
         id,
         first_name_enc, last_name_enc,
         email_enc, phone_enc,
         address_enc, city, zip_code, country
       FROM users
       WHERE id = $1`,
      [userId]
    );
    if (u.rowCount === 0) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    const row = u.rows[0];
    const firstName  = decryptNullable(row.first_name_enc) ?? '';
    const lastName   = decryptNullable(row.last_name_enc) ?? '';
    const emailPlain = (req.body.email ?? decryptNullable(row.email_enc)) ?? '';
    const phonePlain = (req.body.phone ?? decryptNullable(row.phone_enc)) ?? '';

    // 2) Cardholder Marqeta
  const cardholderToken = await createMarqetaCardholder(userId);

// 3) Carte virtuelle Marqeta
const card = await createVirtualCard(cardholderToken);

    // 4) Persist carte
    await client.query(
      `INSERT INTO cards (
         user_id,
         marqeta_card_token,
         marqeta_cardholder_token,
         type,
         status,
         last4,
         funding_currency,
         spending_controls,
         created_at,
         requested_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())`,
      [
        userId,
        card.token,
        cardholderToken,
        CardType.VIRTUAL,
        (card.state || 'ACTIVE').toLowerCase(),
        card.last_four_digits || null,
        CURRENCY_USER, // afficher HTG côté user
        JSON.stringify({
          daily_limit: DEFAULT_SPENDING_LIMIT,
          allowed_categories: ['financial_institutions'],
        }),
      ]
    );

    // 5) 🧾 Transaction d’émission en HTG
    //    - soit forfait HTG (CARD_ISSUANCE_FEE_HTG)
    //    - soit conversion depuis USD (si vous avez un coût USD interne)
    const issuanceUsd = 0; // mettre votre coût USD ici si nécessaire
    const amountHtg =
      feeHtgEnv > 0 ? Math.round(feeHtgEnv) : toHTG(issuanceUsd);

    const recipientEmailEnc  = emailPlain ? encrypt(emailPlain) : null;
    const recipientEmailBidx = emailPlain ? blindIndexEmail(emailPlain) : null;
    const recipientPhoneEnc  = phonePlain ? encrypt(phonePlain) : null;
    const recipientPhoneBidx = phonePlain ? blindIndexPhone(phonePlain) : null;

    await client.query(
      `INSERT INTO transactions (
         user_id,
         type,
         amount,
         currency,
         description,
         recipient_email_enc,
         recipient_email_bidx,
         recipient_phone_enc,
         recipient_phone_bidx,
         created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
      [
        userId,
        'card_virtual_issued',
        amountHtg,                                     // 💰 HTG
        CURRENCY_USER,                                 // "HTG"
        `Émission carte virtuelle Marqeta (${String(card.token).slice(0, 8)}...)`,
        recipientEmailEnc,
        recipientEmailBidx,
        recipientPhoneEnc,
        recipientPhoneBidx,
      ]
    );

    // 6) OK
    return res.json({
      success: true,
      card: {
        token: card.token,
        last4: card.last_four_digits,
        status: (card.state || 'ACTIVE').toLowerCase(),
        currency: CURRENCY_USER,
        daily_limit: DEFAULT_SPENDING_LIMIT,
      },
      transaction: {
        amount: amountHtg,
        currency: CURRENCY_USER,
        type: 'card_virtual_issued',
      },
    });
  } catch (err: any) {
    console.error('Erreur création carte virtuelle (Marqeta/HTG):', err?.response?.data || err?.message || err);
    return res.status(500).json({
      error: 'Échec de la création de la carte',
      details: err?.response?.data || err?.message || 'Erreur inconnue',
    });
  } finally {
    client.release();
  }
};
// 🔒 Verrouiller/déverrouiller la carte
export const toggleCardLock = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { is_locked } = req.body;

  if (!userId) return res.status(401).json({ error: 'Non authentifié' });

  // Dernière carte (virt/phys) active ou pending
  const { rows } = await pool.query(
    `SELECT id, marqeta_card_token
       FROM cards
      WHERE user_id = $1
        AND status IN ($2,$3)
      ORDER BY requested_at DESC
      LIMIT 1`,
    [userId, CardStatus.ACTIVE, CardStatus.PENDING]
  );
  if (rows.length === 0) {
    return res.status(404).json({ error: 'Aucune carte à verrouiller/déverrouiller.' });
  }

  const { id: cardId, marqeta_card_token } = rows[0];
  if (!marqeta_card_token) {
    return res.status(400).json({ error: 'Carte non liée à Marqeta.' });
  }

  try {
    const newState = is_locked ? 'SUSPENDED' : 'ACTIVE';

    await axios.put(
      `${MARQETA_API_BASE}/cards/${marqeta_card_token}`,
      { state: newState },
      { auth: MARQETA_AUTH, headers: { 'Content-Type': 'application/json' } }
    );

    await pool.query(
      `UPDATE cards
          SET is_locked = $1,
              status    = $2,
              updated_at= NOW()
        WHERE id = $3`,
      [!!is_locked, is_locked ? CardStatus.PENDING : CardStatus.ACTIVE, cardId]
    );

    return res.json({ message: `Carte ${is_locked ? 'verrouillée' : 'déverrouillée'} avec succès.` });
  } catch (err: any) {
    console.error('Erreur Marqeta lors du lock/unlock:', err?.response?.data || err?.message || err);
    return res.status(500).json({ error: 'Erreur Marqeta lors du changement de statut de la carte.' });
  }
};



// ❌ Annuler la carte (ne supprime pas !)
// Seul un agent Cash Hay peut supprimer définitivement après audit, sinon on la “lock” et “cancel”
export const cancelCard = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Non authentifié' });

  const { rows } = await pool.query(
    `SELECT id
       FROM cards
      WHERE user_id = $1
        AND category = 'physique'
        AND status IN ($2,$3)
      ORDER BY requested_at DESC
      LIMIT 1`,
    [userId, CardStatus.ACTIVE, CardStatus.PENDING]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'Aucune carte physique à annuler.' });
  }

  const cardId = rows[0].id;

  await pool.query(
    `UPDATE cards
        SET status = 'pending_cancel',
            is_locked = true,
            updated_at = NOW()
      WHERE id = $1`,
    [cardId]
  );

  await pool.query(
    `INSERT INTO audit_logs (user_id, action, details, created_at)
     VALUES ($1, 'request_cancel_card', $2, NOW())`,
    [userId, `Demande d’annulation carte physique ID ${cardId}`]
  );

  return res.json({ message: 'Demande d’annulation enregistrée. Un agent validera la suppression.' });
};


export const requestPhysicalCard = async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Non authentifié' });

    const userId = req.user.id;
    const productToken = process.env.MARQETA_PHYSICAL_CARD_PRODUCT_TOKEN || '';
    if (!productToken) {
      return res.status(500).json({
        error: 'Configuration manquante: MARQETA_PHYSICAL_CARD_PRODUCT_TOKEN',
      });
    }

    // 🎯 Profil (colonnes chiffrées)
    const u = await client.query(
      `SELECT
         id,
         first_name_enc, last_name_enc,
         email_enc, phone_enc,
         address_enc, city, zip_code, country
       FROM users
       WHERE id = $1`,
      [userId]
    );
    if (u.rowCount === 0) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    const row = u.rows[0];
    const firstName  = decryptNullable(row.first_name_enc) ?? 'User';
    const lastName   = decryptNullable(row.last_name_enc) ?? 'CashHay';
    const emailPlain = decryptNullable(row.email_enc) ?? undefined;
    // const phonePlain = decryptNullable(row.phone_enc) ?? undefined; // dispo si besoin

    // 1) Cardholder (Marqeta)
    const cardholderToken = await createMarqetaCardholder(userId);

    // 2) Création carte physique (Marqeta)
    const resp = await axios.post(
      `${MARQETA_API_BASE}/cards`,
      {
        user_token: cardholderToken,
        card_product_token: productToken,
        state: 'INACTIVE',
      },
      { auth: MARQETA_AUTH, headers: { 'Content-Type': 'application/json' } }
    );

    const created = resp.data;
    const cardToken: string = created?.token;
    const last4: string | null = created?.last_four_digits || null;
    const state: string = (created?.state || 'INACTIVE').toLowerCase();

    // 3) Persistance en base
    await client.query(
      `INSERT INTO cards (
         user_id,
         marqeta_card_token,
         marqeta_cardholder_token,
         type,
         status,
         last4,
         funding_currency,
         created_at,
         requested_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())`,
      [
        userId,
        cardToken,
        cardholderToken,
        CardType.PHYSICAL,
        state,
        last4,
        CURRENCY_USER,
      ]
    );

    // 4) Email de confirmation (best-effort, n’impacte pas la réponse)
    if (emailPlain) {
      try {
        const { subject, text, html } = buildCardRequestReceivedEmail({
          firstName,
          // styleLabel: 'Classique Noir',       // si vous avez l’info du style
          requestId: cardToken || undefined,     // référence visible dans l’email
          // statusUrl: 'https://app.cash-hay.com/cards/status', // par défaut dans le template
          // loginUrl: 'https://app.cash-hay.com/login',         // par défaut dans le template
        });
        await sendEmail({ to: emailPlain, subject, text, html });
      } catch (e) {
        console.error('⚠️ Email card request not sent:', e);
      }
    }

    return res.json({
      success: true,
      card: {
        token: cardToken,
        last4,
        status: state,
        currency: CURRENCY_USER,
      },
    });
  } catch (err: any) {
    console.error('Erreur création carte physique (Marqeta):', err?.response?.data || err?.message || err);
    return res.status(500).json({
      error: 'Échec de la création de la carte physique',
      details: err?.response?.data || err?.message || 'Erreur inconnue',
    });
  } finally {
    client.release();
  }
};



export const saveCustomCard = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { style_id, type, price, design_url, label } = req.body;

  if (!userId) return res.status(401).json({ error: 'Non authentifié' });
  if (!style_id || !type || !price || !design_url || !label) {
    return res.status(400).json({ error: 'Champs manquants.' });
  }

  try {
    // 1) s’assure que le style existe
    const { rows } = await pool.query(
      `SELECT * FROM card_types WHERE type = $1`,
      [style_id]
    );

    if (rows.length === 0) {
      await pool.query(
        `INSERT INTO card_types (type, label, price, image_url)
         VALUES ($1, $2, $3, $4)`,
        [style_id, label, price, design_url]
      );
    } else if (!rows[0].image_url && design_url) {
      await pool.query(
        `UPDATE card_types SET image_url = $1 WHERE type = $2`,
        [design_url, style_id]
      );
    }

    // 2) insert user_cards
    await pool.query(
      `INSERT INTO user_cards
         (user_id, style_id, type, category, price, design_url, label, is_current, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)`,
      [userId, style_id, type, 'physique', price, design_url, label, 'pending']
    );

    return res.status(201).json({ message: 'Carte personnalisée enregistrée avec succès.' });
  } catch (err: any) {
    if (err?.code === '23503' && err?.detail?.includes('is not present in table "card_types"')) {
      return res.status(400).json({ error: "Erreur FK: Le modèle de carte n'existe pas dans card_types." });
    }
    console.error('❌ Erreur insertion carte personnalisée:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};





export const getUserCards = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Non authentifié' });

  try {
    const result = await pool.query(
      `SELECT
         uc.*,
         ct.label AS card_label,
         ct.price AS default_price,
         c.status  AS card_status,
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

    return res.json({ cards: result.rows });
  } catch (err) {
    console.error('❌ Erreur récupération cartes:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};




export const getCurrentCard = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Non authentifié' });

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
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};


export const activateCard = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { cvc } = req.body;

  if (!userId) return res.status(401).json({ error: 'Non authentifié' });
  if (!cvc || typeof cvc !== 'string' || cvc.length !== 3) {
    return res.status(400).json({ error: 'Code CVC invalide' });
  }

  try {
    const result = await pool.query(
      `SELECT * FROM cards WHERE user_id = $1 AND type = $2 AND status = $3 LIMIT 1`,
      [userId, CardType.PHYSICAL, CardStatus.PENDING]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Aucune carte physique en attente trouvée.' });
    }

    const card = result.rows[0];
    if (!card.marqeta_card_token) {
      return res.status(400).json({ error: 'Carte non liée à Marqeta.' });
    }

    const marqetaRes = await axios.put(
      `${MARQETA_API_BASE}/cards/${card.marqeta_card_token}`,
      { state: 'ACTIVE' },
      { auth: MARQETA_AUTH, headers: { 'Content-Type': 'application/json' } }
    );

    await pool.query(
      `UPDATE cards SET status = $1, activated_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [CardStatus.ACTIVE, card.id]
    );

    return res.json({ message: 'Carte physique activée avec succès.', marqeta: marqetaRes.data });
  } catch (err: any) {
    console.error('❌ Erreur activation carte physique :', err?.response?.data || err?.message || err);
    return res.status(500).json({ error: err?.response?.data || 'Erreur serveur' });
  }
};


export const selectCardModel = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { style_id, label, price, design_url, is_custom } = req.body;

  if (!userId) return res.status(401).json({ error: 'Non authentifié' });
  if (!style_id || !label || !price || !design_url) {
    return res.status(400).json({ error: 'Champs manquants (style_id, label, price, design_url requis).' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT * FROM card_types WHERE type = $1',
      [style_id]
    );

    if (rows.length === 0) {
      await pool.query(
        `INSERT INTO card_types (type, label, price, image_url)
         VALUES ($1, $2, $3, $4)`,
        [style_id, label, price, design_url]
      );
    }

    await pool.query(
      `INSERT INTO user_cards
        (user_id, style_id, type, price, design_url, label, category, is_current)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
      [
        userId,
        style_id,
        is_custom ? 'custom' : 'classic',
        price,
        design_url,
        label,
        'physique',
      ]
    );

    return res.json({ message: 'Carte enregistrée avec succès.' });
  } catch (err) {
    console.error('❌ Erreur enregistrement carte :', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};



export const getLatestCustomCard = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Non authentifié' });

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

    return res.status(200).json({ card: result.rows[0] });
  } catch (err) {
    console.error('❌ Erreur récupération carte personnalisée:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};




export const assignPhysicalCard = async (req: Request, res: Response) => {
  const { userId, card_number, expiry_date } = req.body;

  if (!userId || !card_number || !expiry_date) {
    return res.status(400).json({ error: 'Champs requis manquants.' });
  }

  try {
    await pool.query(
      `INSERT INTO cards (
         user_id, card_number, expiry_date, type, account_type, status, is_locked, created_at
       ) VALUES ($1, $2, $3, $4, 'debit', 'active', false, NOW())`,
      [userId, card_number, expiry_date, CardType.PHYSICAL]
    );

    return res.status(201).json({ message: 'Carte physique assignée avec succès.' });
  } catch (err) {
    console.error('❌ Erreur assignation carte physique:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};

export const hasCard = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Non authentifié' });

  try {
    const { rows } = await pool.query(
      `SELECT id FROM user_cards WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    return res.json({ hasCard: rows.length > 0 });
  } catch (err) {
    console.error('❌ Erreur vérification carte:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

export const requestPhysicalCustomCard = async (
  req: Request & { user?: { id: string } },
  res: Response
) => {
  const userId = req.user?.id;
  const {
    design_url,
    card_type = 'custom',
    label = 'Carte personnalisée',
  }: CustomCardRequest = req.body;

  // Validation des entrées
  if (!userId) {
    return res.status(401).json({ error: 'Authentification requise.' });
  }
  if (!design_url) {
    return res.status(400).json({
      error: 'URL de design manquante.',
      details: 'Le champ design_url est obligatoire pour une carte personnalisée',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Vérification d’une carte physique courante déjà en cours/active
    const existingCards = await client.query(
      `SELECT id FROM user_cards 
         WHERE user_id = $1 
           AND category = 'physique' 
           AND is_current = true
           AND status IN ('pending', 'active')`,
      [userId]
    );
    if (existingCards.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Demande de carte déjà en cours',
        details: 'Vous avez déjà une carte physique en attente ou active',
      });
    }

    // 2) Enregistrement de la demande
    const ins = await client.query(
      `INSERT INTO user_cards (
         user_id, design_url, type, style_id, 
         price, status, category, is_current, label, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       RETURNING id, created_at`,
      [
        userId,
        design_url,
        card_type,
        'custom',       // style_id
        0,              // price (à adapter selon votre logique)
        'pending',      // status
        'physique',     // category
        true,           // is_current
        label,
      ]
    );

    // 3) Audit log
    await client.query(
      `INSERT INTO audit_logs (user_id, action, details)
       VALUES ($1, $2, $3)`,
      [
        userId,
        'custom_card_request',
        `Nouvelle demande carte physique personnalisée (ID: ${ins.rows[0].id})`,
      ]
    );

    await client.query('COMMIT');

    // 4) Email de confirmation — best-effort (n’empêche pas la réussite API)
    (async () => {
      try {
        const u = await pool.query(
          `SELECT first_name_enc, email_enc FROM users WHERE id = $1`,
          [userId]
        );
        const firstName = decryptNullable(u.rows[0]?.first_name_enc) ?? '';
        const email = decryptNullable(u.rows[0]?.email_enc) ?? '';

        if (email) {
          const { subject, text, html } = buildCardRequestReceivedEmail({
            firstName,
            styleLabel: label,                     // affiche le libellé choisi
            requestId: String(ins.rows[0].id),     // référence visible dans l’email
            // statusUrl et loginUrl ont des valeurs par défaut dans le template
          });
          await sendEmail({ to: email, subject, text, html });
        }
      } catch (e) {
        console.error('⚠️ Email card request (custom) non envoyé :', e);
      }
    })();

    return res.status(201).json({
      success: true,
      message: 'Demande de carte personnalisée enregistrée avec succès.',
      card_request: {
        id: ins.rows[0].id,
        created_at: ins.rows[0].created_at,
        status: 'pending',
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur enregistrement carte personnalisée:', err);
    const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue';
    return res.status(500).json({
      error: 'Échec de la demande de carte',
      details: errorMessage,
    });
  } finally {
    client.release();
  }
};


export const getCardPanFromMarqeta = async (req: Request, res: Response) => {
  const { id } = req.params; // <-- id interne de ta table cards
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Non authentifié' });

    const result = await pool.query(
      'SELECT marqeta_card_token, user_id FROM cards WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Accès interdit à cette carte' });
    }

    const token = result.rows[0].marqeta_card_token;
    if (!token) {
      return res.status(400).json({ error: 'Carte non liée à Marqeta.' });
    }

    const response = await axios.get(
      `${MARQETA_API_BASE}/cards/${token}/pan`,
      { auth: MARQETA_AUTH }
    );

    const { pan, cvv_number, expiration } = response.data;

    // ⚠️ Sécurité: ne renvoie jamais PAN/CVV en clair en prod !
    // Ici c'est uniquement si tu es dans un espace admin ultra restreint.
    return res.json({ pan, cvv: cvv_number, expiration });
  } catch (err: any) {
    console.error('Erreur récupération PAN:', err?.response?.data || err?.message || err);
    return res.status(500).json({ error: 'Impossible de récupérer les infos de carte.' });
  }
};



