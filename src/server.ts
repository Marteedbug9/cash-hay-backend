// src/server.ts
import './config/db'; // ← Connexion à la DB
import dotenv from 'dotenv';
dotenv.config();

import app from './app';

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`🚀 Serveur backend Cash Hay en cours sur le port ${PORT}`);
});



