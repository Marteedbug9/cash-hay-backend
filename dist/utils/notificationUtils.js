"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSMS = exports.sendEmail = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const twilio_1 = __importDefault(require("twilio"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// Initialiser Twilio
const twilioClient = (0, twilio_1.default)(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
// ✅ Envoyer un email
const sendEmail = async ({ to, subject, text, }) => {
    const { EMAIL_USER, EMAIL_PASS } = process.env;
    if (!EMAIL_USER || !EMAIL_PASS) {
        throw new Error('EMAIL_USER ou EMAIL_PASS manquant dans .env');
    }
    const transporter = nodemailer_1.default.createTransport({
        service: 'gmail',
        auth: {
            user: EMAIL_USER,
            pass: EMAIL_PASS,
        },
    });
    try {
        await transporter.sendMail({
            from: `"Cash Hay" <${EMAIL_USER}>`,
            to,
            subject,
            text,
        });
        console.log(`📨 Email envoyé à ${to}`);
    }
    catch (error) {
        console.error('❌ Erreur lors de l’envoi de l’email :', error);
        throw new Error('Échec de l’envoi de l’email.');
    }
};
exports.sendEmail = sendEmail;
// ✅ Envoyer un SMS
const sendSMS = async (phone, message) => {
    const { TWILIO_PHONE_NUMBER } = process.env;
    if (!TWILIO_PHONE_NUMBER) {
        throw new Error('TWILIO_PHONE_NUMBER manquant dans .env');
    }
    try {
        const result = await twilioClient.messages.create({
            body: message,
            to: phone,
            from: TWILIO_PHONE_NUMBER,
        });
        console.log(`📱 SMS envoyé à ${phone} ✅ SID: ${result.sid}`);
    }
    catch (error) {
        console.error('❌ Erreur lors de l’envoi du SMS :', error);
        throw new Error('Échec de l’envoi du SMS.');
    }
};
exports.sendSMS = sendSMS;
