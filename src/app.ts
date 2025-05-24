// src/app.ts
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/authRoutes';

const app = express();

// Middleware global
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);

// Health check
app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'OK' });
});

export default app;
