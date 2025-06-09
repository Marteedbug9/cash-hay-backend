"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/server.ts
require("./config/db"); // Charge la connexion DB
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const transactionRoutes_1 = __importDefault(require("./routes/transactionRoutes"));
const ipRoutes_1 = __importDefault(require("./routes/ipRoutes"));
const cardRoutes_1 = __importDefault(require("./routes/cardRoutes"));
const adminRoutes_1 = __importDefault(require("./routes/adminRoutes"));
const db_1 = __importDefault(require("./config/db")); // Connexion test DB
const app = (0, express_1.default)();
const PORT = process.env.PORT || 4000;
// 🌍 Middlewares globaux
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// 📦 Routes API
app.use('/api/ip', ipRoutes_1.default);
app.use('/api/auth', authRoutes_1.default);
app.use('/api/transactions', transactionRoutes_1.default);
app.use('/api/cards', cardRoutes_1.default);
app.use('/api/admin', adminRoutes_1.default);
// ✅ Vérifie DB et démarre serveur
db_1.default.query('SELECT NOW()')
    .then(() => {
    console.log('✅ Connexion PostgreSQL réussie');
    app.listen(PORT, () => {
        console.log(`🚀 Serveur backend Cash Hay en cours sur le port ${PORT}`);
    });
})
    .catch(err => {
    console.error('❌ Échec connexion PostgreSQL:', err);
    process.exit(1);
});
