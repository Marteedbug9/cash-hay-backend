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
 
  // updateBalance
} from '../controllers/transactionController';
import { verifyToken } from '../middlewares/verifyToken';
import { verifyMember } from '../middlewares/verifyMember';

const router = Router();

// 💰 Solde actuel
router.get('/balance', verifyToken, getBalance);

// 📜 Historique des transactions
router.get('/', verifyToken, getTransactions);

// ➕ Dépôt (option : protège par verifyMember aussi)
router.post('/deposit', verifyToken, verifyMember, deposit);

// ➖ Retrait
router.post('/withdraw', verifyToken, verifyMember, withdraw);

// 🔁 Transfert entre utilisateurs
router.post('/transfer', verifyToken, verifyMember, transfer);

// 📝 Création manuelle d'une transaction (option : protège par verifyMember ?)
router.post('/', verifyToken, verifyMember, createTransaction);

// 📥 Demander de l’argent
router.post('/request', verifyToken, verifyMember, requestMoney);

// ✅ Accepter une demande
router.post('/accept-request', verifyToken, verifyMember, acceptRequest);

// ❌ Refuser ou annuler une demande
router.post('/cancel-request', verifyToken, verifyMember, cancelRequest);



router.get('/transactions/statement', verifyToken, getMonthlyStatement);
// 🔧 Route manquante ?
// router.post('/update-balance', verifyToken, verifyMember, updateBalance);

export default router;
