// src/config/db.ts
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// 🔍 LOG TEMPORAIRE POUR DIAGNOSTIC
console.log('🔎 DATABASE_URL utilisée :', process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Requis par Render
  },
});

export default pool;
