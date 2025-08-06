// src/config/marqetaService.ts

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// ⚠️ Assure-toi que ces variables sont bien définies dans ton .env
const baseURL = process.env.MARQETA_BASE_URL;
const applicationToken = process.env.MARQETA_APPLICATION_TOKEN;
const adminToken = process.env.MARQETA_ADMIN_TOKEN; // anciennement MARQETA_ACCESS_TOKEN

if (!baseURL || !applicationToken || !adminToken) {
  throw new Error('❌ Les variables MARQETA_BASE_URL, MARQETA_APPLICATION_TOKEN et MARQETA_ADMIN_TOKEN doivent être définies dans .env');
}

// Encodage Base64 pour l'autorisation Basic Auth
const auth = Buffer.from(`${applicationToken}:${adminToken}`).toString('base64');

const headers = {
  Authorization: `Basic ${auth}`,
  'Content-Type': 'application/json',
};

// Exemple de fonction de création de cardholder
export async function createCardholder() {
  try {
    const res = await axios.post(
      `${baseURL}/cardholders`,
      {
        first_name: "Jean",
        last_name: "Pierre",
        email: "jeanpierre@example.com",
        token: "jeanpierre1", // Ce token doit être unique dans Marqeta
        active: true,
      },
      { headers }
    );

    console.log('✅ Cardholder created:', res.data);
    return res.data;
  } catch (err: any) {
    console.error('❌ Error creating cardholder:', err.response?.data || err.message);
    throw err;
  }
}
