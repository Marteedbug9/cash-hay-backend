// src/webhooks/marqetaService.ts
import axios from 'axios';
import pool from '../config/db';
import dotenv from 'dotenv';

dotenv.config();

const MARQETA_API_BASE = 'https://sandbox-api.marqeta.com/v3';

const MARQETA_APP_TOKEN = process.env.MARQETA_APP_TOKEN!;
const MARQETA_ADMIN_TOKEN = process.env.MARQETA_ADMIN_TOKEN || '';
const MARQETA_CARD_PRODUCT_TOKEN = process.env.MARQETA_CARD_PRODUCT_TOKEN!;


if (!process.env.MARQETA_APP_TOKEN) {
  throw new Error("❌ MARQETA_APP_TOKEN manquant dans .env");
}


if (!process.env.MARQETA_CARD_PRODUCT_TOKEN) {
  throw new Error("❌ MARQETA_CARD_PRODUCT_TOKEN manquant dans .env");
}


const AUTH = {
  username: MARQETA_APP_TOKEN,
  password: MARQETA_ADMIN_TOKEN,
};

/**
 * Crée un utilisateur Marqeta (cardholder)
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
 * Crée une carte virtuelle
 */
export const createVirtualCard = async (cardholderToken: string) => {
  const payload = {
    card_product_token: MARQETA_CARD_PRODUCT_TOKEN,
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

/**
 * Crée une carte physique
 */
export const createPhysicalCard = async (cardholderToken: string) => {
  try {
    const response = await axios.post(`${MARQETA_API_BASE}/cards`, {
      card_product_token: MARQETA_CARD_PRODUCT_TOKEN,
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

/**
 * Active une carte physique
 */
export const activatePhysicalCard = async (cardToken: string, pin: string) => {
  try {
    await axios.post(`${MARQETA_API_BASE}/cards/${cardToken}/set_card_pin`, {
      card_token: cardToken,
      pin,
    }, { auth: AUTH });

    const transitionRes = await axios.post(`${MARQETA_API_BASE}/cards/${cardToken}/transition`, {
      channel: 'API',
      state: 'ACTIVE',
    }, { auth: AUTH });

    console.log(`✅ Carte activée : ${cardToken}`);
    return transitionRes.data;
  } catch (error: any) {
    console.error('❌ Erreur activation carte:', error.response?.data || error.message);
    throw new Error("Erreur lors de l’activation de la carte");
  }
};

/**
 * Récupère les infos de livraison d'une carte
 */
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

/**
 * Sauvegarde une carte (virtuelle ou physique) dans la base
 */
export const saveCardToDatabase = async (
  userId: string,
  cardData: any,
  type: 'virtual' | 'physical'
) => {
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

/**
 * Liste tous les produits de carte configurés dans Marqeta
 */
export const listCardProducts = async () => {
  try {
    const response = await axios.get(`${MARQETA_API_BASE}/cardproducts?count=10`, {
      auth: AUTH,
    });

    console.log('📦 Liste des card products disponibles :');
    response.data.data.forEach((product: any, index: number) => {
      console.log(`\n🪪 #${index + 1}`);
      console.log(`Token        : ${product.token}`);
      console.log(`Name         : ${product.name}`);
      console.log(`Active       : ${product.active}`);
      console.log(`Created Time : ${product.createdTime}`);
    });

    return response.data.data;
  } catch (err: any) {
    console.error('❌ Erreur récupération card products :', err.response?.data || err.message);
    throw new Error("Impossible de lister les produits de carte");
  }
};
listCardProducts();
