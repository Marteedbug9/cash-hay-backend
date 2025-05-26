import express from 'express';
import cors from 'cors';
import authRoutes from './routes/authRoutes';
import adminRoutes from './routes/adminRoutes'; // ✅ ajout des routes admin

const app = express();

// 🌍 Middlewares globaux
app.use(cors());
app.use(express.json());

// 🔐 Routes publiques et protégées utilisateur
app.use('/api/auth', authRoutes);

// 🛡️ Routes réservées aux administrateurs
app.use('/api/admin', adminRoutes);

// ✅ Route de santé (monitoring)
app.get('/healthz', (req: express.Request, res: express.Response) => {
  res.status(200).json({ status: 'OK' });
});

export default app;
