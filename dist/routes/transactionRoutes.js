"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/transactionRoutes.ts
const express_1 = require("express");
const transactionController_1 = require("../controllers/transactionController");
const verifyToken_1 = require("../middlewares/verifyToken");
const router = (0, express_1.Router)();
// ➤ Historique des transactions
router.get('/', verifyToken_1.verifyToken, transactionController_1.getTransactions);
// ➤ Création de transaction (manuelle ou transfert)
router.post('/', verifyToken_1.verifyToken, transactionController_1.createTransaction);
// ➤ Dépôt manuel
router.post('/deposit', verifyToken_1.verifyToken, transactionController_1.deposit);
// ➤ Retrait manuel
router.post('/withdraw', verifyToken_1.verifyToken, transactionController_1.withdraw);
router.post('/transfer', verifyToken_1.verifyToken, transactionController_1.transfer);
router.get('/balance', verifyToken_1.verifyToken, transactionController_1.getBalance);
exports.default = router;
