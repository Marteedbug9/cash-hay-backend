"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetPassword = exports.verifyEmailForRecovery = exports.startRecovery = void 0;
const db_1 = __importDefault(require("../config/db"));
const crypto_1 = __importDefault(require("crypto"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const notificationUtils_1 = require("../utils/notificationUtils");
// ❌ En mémoire pour dev seulement (Redis recommandé en production)
const recoveryStore = {};
// ✨ Masquer une adresse email
const maskEmail = (_, a, b, c) => {
    return a + '*'.repeat(b.length) + c;
};
// ✅ Étape 1 : Lancer la récupération de compte
const startRecovery = async (req, res) => {
    const { credentialType, value } = req.body;
    try {
        let result;
        if (credentialType === 'username') {
            result = await db_1.default.query('SELECT id, email FROM users WHERE username = $1', [value]);
        }
        else if (credentialType === 'email') {
            result = await db_1.default.query('SELECT id, email FROM users WHERE email = $1', [value]);
        }
        else {
            return res.status(400).json({ error: 'Type de credential invalide.' });
        }
        const user = result.rows[0];
        if (!user)
            return res.status(404).json({ error: 'Utilisateur introuvable.' });
        const maskedEmail = user.email.replace(/(.{2})(.*)(@.*)/, maskEmail);
        const recoveryId = crypto_1.default.randomBytes(16).toString('hex');
        recoveryStore[recoveryId] = { email: user.email };
        res.json({ maskedEmail, userId: recoveryId });
    }
    catch (err) {
        console.error('[startRecovery] Erreur:', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
};
exports.startRecovery = startRecovery;
// ✅ Étape 2 : Vérifier l'adresse email
const verifyEmailForRecovery = async (req, res) => {
    const { userId, verifiedEmail } = req.body;
    try {
        const stored = recoveryStore[userId];
        if (!stored || stored.email !== verifiedEmail) {
            return res.status(400).json({ error: 'Vérification échouée.' });
        }
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        stored.otp = otp;
        await (0, notificationUtils_1.sendEmail)({
            to: verifiedEmail,
            subject: 'Code OTP - Cash Hay',
            text: `Voici votre code de vérification : ${otp}`,
        });
        res.json({ message: 'Code envoyé à votre email.' });
    }
    catch (err) {
        console.error('[verifyEmailForRecovery] Erreur:', err);
        res.status(500).json({ error: 'Erreur serveur lors de la vérification.' });
    }
};
exports.verifyEmailForRecovery = verifyEmailForRecovery;
// ✅ Étape 3 : Réinitialiser le mot de passe
const resetPassword = async (req, res) => {
    const { userId, otp, newPassword } = req.body;
    try {
        const stored = recoveryStore[userId];
        if (!stored || stored.otp !== otp) {
            return res.status(400).json({ error: 'OTP invalide ou expiré.' });
        }
        const hashedPassword = await bcrypt_1.default.hash(newPassword, 10);
        await db_1.default.query('UPDATE users SET password = $1 WHERE email = $2', [hashedPassword, stored.email]);
        delete recoveryStore[userId];
        res.json({ message: 'Mot de passe réinitialisé avec succès.' });
    }
    catch (err) {
        console.error('[resetPassword] Erreur:', err);
        res.status(500).json({ error: 'Erreur serveur.' });
    }
};
exports.resetPassword = resetPassword;
