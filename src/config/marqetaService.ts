import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const baseURL = process.env.MARQETA_BASE_URL!;
const applicationToken = process.env.MARQETA_APPLICATION_TOKEN!;
const accessToken = process.env.MARQETA_ACCESS_TOKEN!;

// Encodage en base64
const auth = Buffer.from(`${applicationToken}:${accessToken}`).toString('base64');

const headers = {
  Authorization: `Basic ${auth}`,
  'Content-Type': 'application/json',
};

export async function createCardholder() {
  try {
    const res = await axios.post(
      `${baseURL}/cardholders`,
      {
        first_name: "Jean",
        last_name: "Pierre",
        email: "jeanpierre@example.com",
        token: "jeanpierre1",
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
