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
  getMonthlyStatement,
} from '../controllers/transactionController';
import { verifyToken } from '../middlewares/verifyToken';
import { verifyMember } from '../middlewares/verifyMember';

const router = Router();

// 💰 Solde actuel
router.get('/balance', verifyToken, getBalance);

// 📜 Historique des transactions
router.get('/', verifyToken, getTransactions);

// ➕ Dépôt (protégé)
router.post('/deposit', verifyToken, verifyMember, deposit);

// ➖ Retrait
router.post('/withdraw', verifyToken, verifyMember, withdraw);

// 🔁 Transfert
router.post('/transfer', verifyToken, verifyMember, transfer);

// 📝 Création manuelle d'une transaction
router.post('/', verifyToken, verifyMember, createTransaction);

// 📥 Demande d’argent
router.post('/request', verifyToken, verifyMember, requestMoney);

// ✅ Accepter une demande
router.post('/accept-request/:id', verifyToken, verifyMember, acceptRequest);

// ❌ Annuler une demande
router.post('/cancel-request/:id', verifyToken, verifyMember, cancelRequest);

// 📄 Relevé PDF
router.get('/statement', verifyToken, getMonthlyStatement);

export default router;
