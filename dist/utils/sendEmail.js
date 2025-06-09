"use strict";
// src/utils/sendEmail.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const nodemailer_1 = __importDefault(require("nodemailer"));
const sendEmail = async ({ to, subject, text, html }) => {
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;
    if (!user || !pass) {
        throw new Error('❌ EMAIL_USER ou EMAIL_PASS non défini dans .env');
    }
    const transporter = nodemailer_1.default.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false, // true pour port 465
        auth: {
            user,
            pass,
        },
    });
    const mailOptions = {
        from: `"Cash Hay" <${user}>`,
        to,
        subject,
        text,
        html,
    };
    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`📧 Email envoyé à ${to} ✅`, info.response);
    }
    catch (err) {
        console.error('❌ Échec de l’envoi de l’email :', err);
        throw new Error('Erreur d’envoi email');
    }
};
exports.default = sendEmail;
