// src/webhooks/marqetaService.ts
import axios from 'axios';
import pool from '../config/db';
import dotenv from 'dotenv';

dotenv.config();

const MARQETA_API_BASE = 'https://sandbox-api.marqeta.com/v3';

const AUTH = {
  username: process.env.MARQETA_APP_TOKEN!,
  password: process.env.MARQETA_ADMIN_TOKEN!, // peut rester vide si non requis dans sandbox
};

export const createMarqetaCardholder = async (userId: string): Promise<string> => {
  const userRes = await pool.query(`SELECT * FROM users WHERE id = $1`, [userId]);
  if (userRes.rowCount === 0) throw new Error('Utilisateur non trouvé');
  const user = userRes.rows[0];

  const cardholderToken = `user_${user.id}`;

  try {
    await axios.post(`${MARQETA_API_BASE}/cardholders`, {
      token: cardholderToken,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      phone: user.phone,
      active: true,
      address: {
        line1: user.address || 'Adresse inconnue',
        city: user.city || 'Port-au-Prince',
        state: user.department || 'Ouest',
        postal_code: user.zip_code || 'HT9999',
        country: 'HT',
      },
    }, { auth: AUTH });

    console.log(`✅ Cardholder Marqeta créé : ${cardholderToken}`);
    return cardholderToken;

  } catch (error: any) {
    console.error('❌ Erreur création cardholder Marqeta:', error.response?.data || error.message);
    throw new Error("Erreur Marqeta - cardholder non créé");
  }
};

export const createVirtualCard = async (cardholderToken: string) => {
  try {
    const response = await axios.post(`${MARQETA_API_BASE}/cards`, {
      card_product_token: process.env.MARQETA_CARD_PRODUCT_TOKEN!,
      cardholder_token: cardholderToken,
    }, { auth: AUTH });

    console.log(`✅ Carte virtuelle Marqeta créée pour ${cardholderToken}`);
    return response.data;

  } catch (error: any) {
    console.error('❌ Erreur création carte virtuelle Marqeta:', error.response?.data || error.message);
    throw new Error("Erreur Marqeta - carte non créée");
  }
};
