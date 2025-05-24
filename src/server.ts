/*src/server.ts
import express from 'express';
import authRoutes from './routes/authRoutes';

const app = express();
const PORT = 3000;

app.use(express.json());
app.use('/api/auth', authRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`);
});*/


// src/server.ts
import './config/db'; // ← Connexion à la DB
import dotenv from 'dotenv';
dotenv.config();

import app from './app';

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`🚀 Serveur backend Cash Hay en cours sur le port ${PORT}`);
});



