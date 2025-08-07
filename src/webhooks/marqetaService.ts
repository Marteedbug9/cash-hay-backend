// src/webhooks/marqetaService.ts
import axios from 'axios';
import pool from '../config/db';
import dotenv from 'dotenv';

dotenv.config();

const MARQETA_API_BASE = 'https://sandbox-api.marqeta.com/v3';

const AUTH = {
  username: process.env.MARQETA_APP_TOKEN!,
  password: process.env.MARQETA_ADMIN_TOKEN || '', // vide autorisé en sandbox
};

/**
 * Crée un utilisateur Marqeta (cardholder) avec le token `user_<uuid>`
 */
export const createMarqetaCardholder = async (userId: string): Promise<string> => {
  const userRes = await pool.query(`SELECT * FROM users WHERE id = $1`, [userId]);
  if (userRes.rowCount === 0) throw new Error('Utilisateur non trouvé');

  const user = userRes.rows[0];
  const cardholderToken = `user_${user.id}`;

  const payload = {
    token: cardholderToken,
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
    phone: user.phone,
    active: true,
    uses_parent_account: false,
    address: {
      line1: user.address || 'Adresse inconnue',
      city: user.city || 'Port-au-Prince',
      state: user.department || 'Ouest',
      postal_code: user.zip_code || 'HT9999',
      country: 'HT',
    },
  };

  try {
    await axios.post(`${MARQETA_API_BASE}/cardholders`, payload, { auth: AUTH });
    console.log(`✅ Cardholder Marqeta créé : ${cardholderToken}`);
    return cardholderToken;
  } catch (error: any) {
    console.error('❌ Erreur création cardholder Marqeta:', error.response?.data || error.message);
    throw new Error("Erreur Marqeta - cardholder non créé");
  }
};

/**
 * Crée une carte virtuelle Marqeta pour un cardholder
 */
export const createVirtualCard = async (cardholderToken: string) => {
  const payload = {
    card_product_token: process.env.MARQETA_CARD_PRODUCT_TOKEN!,
    cardholder_token: cardholderToken,
  };

  try {
    const response = await axios.post(`${MARQETA_API_BASE}/cards`, payload, { auth: AUTH });
    console.log(`✅ Carte virtuelle Marqeta créée pour ${cardholderToken}`);
    return response.data;
  } catch (error: any) {
    console.error('❌ Erreur création carte virtuelle Marqeta:', error.response?.data || error.message);
    throw new Error("Erreur Marqeta - carte non créée");
  }
};


export const createPhysicalCard = async (cardholderToken: string) => {
  try {
    const response = await axios.post(`${MARQETA_API_BASE}/cards`, {
      card_product_token: process.env.MARQETA_CARD_PRODUCT_TOKEN!,
      cardholder_token: cardholderToken,
      state: 'UNACTIVATED',
      fulfillment: {
        payment_instrument: 'PHYSICAL',
        shipping: {
          method: 'STANDARD',
          recipient_address: {
            line1: 'Adresse inconnue',
            city: 'Port-au-Prince',
            state: 'Ouest',
            postal_code: 'HT9999',
            country: 'HT',
          },
        },
      },
    }, { auth: AUTH });

    console.log(`📦 Carte physique Marqeta créée pour ${cardholderToken}`);
    return response.data;
  } catch (error: any) {
    console.error('❌ Erreur création carte physique Marqeta:', error.response?.data || error.message);
    throw new Error("Erreur Marqeta - carte physique non créée");
  }
};

export const activatePhysicalCard = async (cardToken: string, pin: string) => {
  try {
    // 1. Définir le code PIN
    await axios.post(`${MARQETA_API_BASE}/cards/${cardToken}/set_card_pin`, {
      card_token: cardToken,
      pin
    }, { auth: AUTH });

    // 2. Changer l’état de la carte
    const transitionRes = await axios.post(`${MARQETA_API_BASE}/cards/${cardToken}/transition`, {
      channel: 'API',
      state: 'ACTIVE'
    }, { auth: AUTH });

    console.log(`✅ Carte activée : ${cardToken}`);
    return transitionRes.data;
  } catch (error: any) {
    console.error('❌ Erreur activation carte:', error.response?.data || error.message);
    throw new Error("Erreur lors de l’activation de la carte");
  }
};


export const getCardShippingInfo = async (cardToken: string) => {
  try {
    const res = await axios.get(`${MARQETA_API_BASE}/cards/${cardToken}`, {
      auth: AUTH,
    });

    const fulfillmentInfo = res.data.fulfillment;
    console.log(`📦 Infos de livraison récupérées pour ${cardToken}`);
    return fulfillmentInfo;
  } catch (error: any) {
    console.error('❌ Erreur récupération livraison:', error.response?.data || error.message);
    throw new Error("Impossible de récupérer les infos de livraison");
  }
};

export const saveCardToDatabase = async (userId: string, cardData: any, type: 'virtual' | 'physical') => {
  try {
    await pool.query(`
      INSERT INTO cards (
        id, user_id, marqeta_card_token, marqeta_cardholder_token,
        type, status, last4, created_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW()
      )
    `, [
      userId,
      cardData.token,
      cardData.cardholder_token,
      type,
      cardData.state,
      cardData.last_four_digits,
    ]);

    console.log(`💾 Carte ${type} enregistrée en base pour user ${userId}`);
  } catch (err) {
    console.error('❌ Erreur insertion carte:', err);
    throw new Error("Carte non enregistrée en base");
  }
};
