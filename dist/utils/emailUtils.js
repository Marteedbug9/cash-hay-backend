"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyOTP = exports.storeOTP = exports.sendOTP = exports.sendSecurityAlertEmail = exports.maskEmail = void 0;
const db_1 = __importDefault(require("../config/db"));
const notificationUtils_1 = require("./notificationUtils");
const maskEmail = (email) => {
    const [user, domain] = email.split('@');
    const maskedUser = user.slice(0, 2) + '***';
    return `${maskedUser}@${domain}`;
};
exports.maskEmail = maskEmail;
const sendSecurityAlertEmail = async (to) => {
    const content = `Une tentative de récupération de votre compte a été détectée.`;
    await (0, notificationUtils_1.sendEmail)({
        to,
        subject: 'Alerte Sécurité',
        text: content,
    });
};
exports.sendSecurityAlertEmail = sendSecurityAlertEmail;
const sendOTP = async (phone, email, otp) => {
    try {
        await (0, notificationUtils_1.sendEmail)({
            to: email,
            subject: 'Votre code de réinitialisation',
            text: `Code: ${otp}`,
        });
        await (0, notificationUtils_1.sendSMS)(phone, `Votre code est : ${otp}`);
    }
    catch (error) {
        console.error('Erreur lors de l’envoi OTP :', error);
        throw new Error('Échec de l’envoi du code OTP.');
    }
};
exports.sendOTP = sendOTP;
const storeOTP = async (userId, otp) => {
    await db_1.default.query('DELETE FROM otps WHERE user_id = $1', [userId]);
};
exports.storeOTP = storeOTP;
const verifyOTP = async (userId, code) => {
    const result = await db_1.default.query('SELECT * FROM otps WHERE user_id = $1 AND code = $2 AND expires_at > NOW()', [userId, code]);
    return result.rows.length > 0;
};
exports.verifyOTP = verifyOTP;
