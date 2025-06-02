// src/routes/transactionRoutes.ts
import { Router } from 'express';
import { getTransactions } from '../controllers/transactionController';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = Router();
router.get('/', authenticateToken, getTransactions);

// src/routes/transactionRoutes.ts
import { createTransaction } from '../controllers/transactionController';
router.post('/', authenticateToken, createTransaction);

export default router;
