import axios from 'axios';
import pool from '../config/db';

const MARQETA_API_BASE = 'https://sandbox-api.marqeta.com/v3';
const AUTH = {
  username: process.env.MARQETA_APP_TOKEN!,
  password: process.env.MARQETA_ADMIN_TOKEN!,
};

export const createMarqetaCardholder = async (userId: string) => {
  const userRes = await pool.query(`SELECT * FROM users WHERE id = $1`, [userId]);
  if (userRes.rowCount === 0) throw new Error('Utilisateur non trouvé');
  const user = userRes.rows[0];

  const cardholderToken = `user_${user.id}`; // Marqeta veut un token unique

  await axios.post(`${MARQETA_API_BASE}/cardholders`, {
    token: cardholderToken,
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
    phone: user.phone,
    active: true,
    address: {
      line1: user.address || 'N/A',
      city: user.city || 'Port-au-Prince',
      state: user.department || 'Ouest',
      postal_code: user.zip_code || 'HT9999',
      country: 'HT'
    }
  }, { auth: AUTH });

  return cardholderToken;
};



export const createVirtualCard = async (cardholderToken: string) => {
  const response = await axios.post(`${MARQETA_API_BASE}/cards`, {
    card_product_token: process.env.MARQETA_CARD_PRODUCT_TOKEN!,
    cardholder_token: cardholderToken
  }, { auth: AUTH });

  return response.data;
};