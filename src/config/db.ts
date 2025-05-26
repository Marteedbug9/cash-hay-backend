import dotenv from 'dotenv';
dotenv.config(); // <-- doit être AVANT tout

import { Pool } from 'pg';

console.log('🔎 DATABASE_URL utilisée :', process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false, // ✅ SSL que pour Render
});

export default pool;
