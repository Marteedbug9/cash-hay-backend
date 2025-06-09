"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const adminRoutes_1 = __importDefault(require("./routes/adminRoutes"));
const transactionRoutes_1 = __importDefault(require("./routes/transactionRoutes"));
const app = (0, express_1.default)();
// 🌍 Middlewares globaux
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// 🔐 Routes publiques et protégées utilisateur
app.use('/api/auth', authRoutes_1.default);
// 🛡️ Routes réservées aux administrateurs
app.use('/api/admin', adminRoutes_1.default);
// ✅ Route de santé (monitoring)
app.get('/healthz', (req, res) => {
    res.status(200).json({ status: 'OK' });
});
// ✅ Répond à GET /api pour éviter l'erreur 404
app.get('/api', (req, res) => {
    res.status(200).json({ message: '✅ API Cash Hay opérationnelle' });
});
// ✅ Route de transaction
app.use('/api/transactions', transactionRoutes_1.default);
exports.default = app;
