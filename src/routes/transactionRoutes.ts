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
  // updateBalance // 🔧 Si tu veux l'utiliser, décommente et ajoute la route en bas
} from '../controllers/transactionController';
import { verifyToken } from '../middlewares/verifyToken';

const router = Router();

// 💰 Solde actuel
router.get('/balance', verifyToken, getBalance);

// 📜 Historique des transactions
router.get('/', verifyToken, getTransactions);

// ➕ Dépôt
router.post('/deposit', verifyToken, deposit);

// ➖ Retrait
router.post('/withdraw', verifyToken, withdraw);

// 🔁 Transfert entre utilisateurs
router.post('/transfer', verifyToken, transfer);

// 📝 Création manuelle d'une transaction
router.post('/', verifyToken, createTransaction);

// 📥 Demander de l’argent
router.post('/request', verifyToken, requestMoney);

// ✅ Accepter une demande
router.post('/accept-request', verifyToken, acceptRequest);

// ❌ Refuser ou annuler une demande
router.post('/cancel-request', verifyToken, cancelRequest);

// 📋 Liste des demandes
router.get('/requests', verifyToken, getRequests);

// 🔧 Route manquante ?
// router.post('/update-balance', verifyToken, updateBalance);

export default router;
