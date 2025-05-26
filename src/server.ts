// src/server.ts
import './config/db'; // ← Connexion à la DB
import dotenv from 'dotenv';
import pool from './config/db'; // ✅ On importe le pool ici pour tester la connexion
dotenv.config();

import app from './app';

const PORT = process.env.PORT || 4000;

// ✅ Tester la connexion à la base de données avant de démarrer le serveur
pool.query('SELECT NOW()')
  .then(() => {
    console.log('✅ Connexion PostgreSQL réussie');
    app.listen(PORT, () => {
      console.log(`🚀 Serveur backend Cash Hay en cours sur le port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ Échec connexion PostgreSQL:', err.message);
    process.exit(1); // Arrête l'app si la connexion échoue
  });
