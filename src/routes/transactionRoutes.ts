// src/routes/transactionRoutes.ts
import { Router } from 'express';
import {
  getTransactions,
  createTransaction,
  deposit,
  withdraw,
  transfer,
  getBalance,
  requestMoney,
  acceptRequest,
  cancelRequest,
  getRequests,
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

router.post('/request', verifyToken, requestMoney);

router.post('/accept-request', verifyToken, acceptRequest);

router.post('/cancel-request', verifyToken, cancelRequest);

router.get('/requests', verifyToken, getRequests);

router.get('/balance', verifyToken, getBalance);
export default router;
