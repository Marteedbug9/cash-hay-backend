// src/routes/transactionRoutes.ts
import { Router } from 'express';
import {
  getTransactions,
  createTransaction,
  deposit,
  withdraw
} from '../controllers/transactionController';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = Router();

// ➤ Historique des transactions
router.get('/', authenticateToken, getTransactions);

// ➤ Création de transaction (manuelle ou transfert)
router.post('/', authenticateToken, createTransaction);

// ➤ Dépôt manuel
router.post('/deposit', authenticateToken, deposit);

// ➤ Retrait manuel
router.post('/withdraw', authenticateToken, withdraw);

export default router;
