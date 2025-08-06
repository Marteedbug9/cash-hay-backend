import axios from 'axios';
import dotenv from 'dotenv';
import { buildMarqetaCardRequest } from '../utils/cardUtils';

dotenv.config();

// Chargement des variables d'environnement
const MARQETA_BASE_URL = process.env.MARQETA_BASE_URL!;
const MARQETA_ADMIN_TOKEN = process.env.MARQETA_ADMIN_TOKEN!;

// Fonction pour créer une carte virtuelle Marqeta
export const createVirtualCard = async (userToken: string, cardProductToken: string) => {
  try {
    const payload = buildMarqetaCardRequest({ userToken, cardProductToken });

    const response = await axios.post(
      `${MARQETA_BASE_URL}/cards`,
      payload,
      {
        auth: {
          username: MARQETA_ADMIN_TOKEN,
          password: '', // Seul le token en username est requis pour Marqeta sandbox
        },
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data;
  } catch (error: any) {
    console.error('❌ Erreur lors de la création de la carte virtuelle :', error.response?.data || error.message);
    throw error;
  }
};
