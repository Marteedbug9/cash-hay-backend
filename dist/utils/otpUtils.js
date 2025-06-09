"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyOTP = exports.storeOTP = exports.sendOTP = exports.generateOTP = void 0;
const db_1 = __importDefault(require("../config/db"));
const notificationUtils_1 = require("./notificationUtils");
// Génère un OTP à 6 chiffres
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};
exports.generateOTP = generateOTP;
// Envoie un OTP par email et SMS, puis le stocke
const sendOTP = async (userId, phone, email) => {
    const otp = (0, exports.generateOTP)();
    await (0, notificationUtils_1.sendEmail)({
        to: email,
        subject: 'Code de vérification Cash Hay',
        text: `Votre code de vérification est : ${otp}`,
    });
    await (0, notificationUtils_1.sendSMS)(phone, `Votre code de vérification Cash Hay est : ${otp}`);
    console.log(`✅ OTP "${otp}" envoyé à ${phone} (SMS) et ${email} (email) pour user ${userId}`);
    await (0, exports.storeOTP)(userId, otp);
};
exports.sendOTP = sendOTP;
// Stocke l'OTP avec date d'expiration (10 minutes)
const storeOTP = async (userId, otp) => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60000); // 10 min
    await db_1.default.query('INSERT INTO otps (user_id, code, created_at, expires_at) VALUES ($1, $2, $3, $4)', [userId, otp, now, expiresAt]);
};
exports.storeOTP = storeOTP;
// Vérifie l'OTP (valide et pas expiré)
const verifyOTP = async (userId, inputCode) => {
    const result = await db_1.default.query('SELECT code, expires_at FROM otps WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [userId]);
    if (result.rows.length === 0)
        return { valid: false, reason: 'Aucun code trouvé' };
    const { code, expires_at } = result.rows[0];
    const now = new Date();
    if (now > new Date(expires_at))
        return { valid: false, reason: 'Code expiré' };
    if (code !== inputCode)
        return { valid: false, reason: 'Code invalide' };
    await db_1.default.query('DELETE FROM otps WHERE user_id = $1', [userId]);
    return { valid: true };
};
exports.verifyOTP = verifyOTP;
