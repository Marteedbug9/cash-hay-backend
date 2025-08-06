// src/server.ts
import './config/db'; // Charge la connexion DB
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';

import authRoutes from './routes/authRoutes';
import transactionRoutes from './routes/transactionRoutes';
import ipRoutes from './routes/ipRoutes';
import cardRoutes from './routes/cardRoutes';
import adminRoutes from './routes/adminRoutes';
import memberRoutes from './routes/memberRoutes';
import notificationsRoutes from './routes/notificationsRoutes';
import requestRoutes from './routes/requestRoutes';
import businessAccountRoutes from './routes/businessAccountRoutes';
import businessAdminRoutes from './routes/businessAdminRoutes';
import authorizationRoutes from './routes/authorizationRoutes';
import pool from './config/db'; // Connexion test DB

const app = express();
const PORT = process.env.PORT || 4000;

// 🌍 Middlewares globaux
app.use(cors());
app.use(express.json());

// 📦 Routes API
app.use('/api/ip', ipRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/cards', cardRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/members', memberRoutes);

app.use('/api/notifications', notificationsRoutes);
app.use('/api/requests', requestRoutes);

app.use('/api', businessAccountRoutes);
app.use('/api/business-admin', businessAdminRoutes);

app.use('/api/authorizations', authorizationRoutes);

// ✅ Vérifie DB et démarre serveur
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
