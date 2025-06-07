import express from 'express';
import cors from 'cors';
import authRoutes from './routes/authRoutes';
import adminRoutes from './routes/adminRoutes'; // ✅ ajout des routes admin
import transactionRoutes from './routes/transactionRoutes';

const app = express();

// 🌍 Middlewares globaux
app.use(cors());
app.use(express.json());

// 🔐 Routes publiques et protégées utilisateur
app.use('/api/auth', authRoutes);

// 🛡️ Routes réservées aux administrateurs
app.use('/api/admin', adminRoutes);

// ✅ Route de santé (monitoring)
app.get('/healthz', (req, res)  => {
  res.status(200).json({ status: 'OK' });
});

// ✅ Répond à GET /api pour éviter l'erreur 404
app.get('/api', (req, res) => {
  res.status(200).json({ message: '✅ API Cash Hay opérationnelle' });
});

// ✅ Route de transaction
app.use('/api/transactions', transactionRoutes);
export default app;
