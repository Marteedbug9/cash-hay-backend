// src/routes/transactionRoutes.ts
import { Router } from 'express';
import {
  getTransactions,
  createTransaction,
  deposit,
  withdraw,
  transfer,
  getBalance,
  updateBalance
} from '../controllers/transactionController';
import { verifyToken } from '../middlewares/verifyToken';


const router = Router();

// ➤ Historique des transactions
router.get('/', verifyToken, getTransactions);

// ➤ Création de transaction (manuelle ou transfert)
router.post('/', verifyToken, createTransaction);

// ➤ Dépôt manuel
router.post('/deposit', verifyToken, deposit);

// ➤ Retrait manuel
router.post('/withdraw', verifyToken, withdraw);

router.post('/transfer', verifyToken, transfer);

router.get('/balance', verifyToken, getBalance);
export default router;
