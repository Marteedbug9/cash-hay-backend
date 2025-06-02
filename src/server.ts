import './config/db'; // Connexion à la DB
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';

import authRoutes from './routes/authRoutes';
import transactionRoutes from './routes/transactionRoutes';
import ipRoutes from './routes/ipRoutes';

const app = express();
const PORT = process.env.PORT || 4000;

// 🌍 Middlewares
app.use(cors());
app.use(express.json());

// 🔐 Routes
app.use('/api', ipRoutes); // Pour sécurité IP ou journalisation
app.use('/api', authRoutes); // Authentification, identité, OTP
app.use('/api/transactions', transactionRoutes); // Transactions, dépôts, retraits

// ✅ Tester la connexion à la DB avant lancement
import pool from './config/db';
pool.query('SELECT NOW()')
  .then(() => {
    console.log('✅ Connexion PostgreSQL réussie');
    app.listen(PORT, () => {
      console.log(`🚀 Serveur backend Cash Hay en cours sur le port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ Échec connexion PostgreSQL:', err);
    process.exit(1);
  });
