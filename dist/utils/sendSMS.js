"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSMS = void 0;
// src/utils/sendSMS.ts
const twilioClient_1 = __importDefault(require("./twilioClient"));
const fromNumber = process.env.TWILIO_PHONE;
if (!fromNumber) {
    throw new Error('❌ TWILIO_PHONE est manquant dans le fichier .env');
}
const sendSMS = async (to, message) => {
    try {
        const result = await twilioClient_1.default.messages.create({
            body: message,
            from: fromNumber,
            to,
        });
        console.log(`📲 SMS envoyé à ${to} ✅ SID: ${result.sid}`);
    }
    catch (error) {
        console.error('❌ Erreur lors de l’envoi du SMS :', error);
        throw new Error('Échec de l’envoi du SMS.');
    }
};
exports.sendSMS = sendSMS;
