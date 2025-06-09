"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyAdmin = exports.verifyToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token manquant ou invalide.' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET || 'devsecretkey');
        // ✅ Vérifie que c’est bien un objet et qu’il a un champ id
        if (typeof decoded !== 'object' || !('id' in decoded)) {
            return res.status(403).json({ error: 'Token invalide.' });
        }
        // ✅ Cast vers UserPayload
        req.user = decoded;
        if (req.user?.is_otp_verified === false) {
            return res.status(401).json({ error: 'OTP non vérifié.' });
        }
        next();
    }
    catch (err) {
        console.error('❌ Erreur de vérification du token :', err);
        return res.status(403).json({ error: 'Accès non autorisé.' });
    }
};
exports.verifyToken = verifyToken;
const verifyAdmin = (req, res, next) => {
    const user = req.user;
    if (user?.role !== 'admin') {
        return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
    }
    next();
};
exports.verifyAdmin = verifyAdmin;
