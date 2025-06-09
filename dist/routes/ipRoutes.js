"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/ipRoutes.ts
const express_1 = require("express");
const axios_1 = __importDefault(require("axios"));
const router = (0, express_1.Router)();
router.get('/ip-info', async (req, res) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const clientIP = Array.isArray(ip) ? ip[0] : ip?.split(',')[0] || '127.0.0.1';
    try {
        const response = await axios_1.default.get(`http://ip-api.com/json/${clientIP}`);
        return res.json(response.data);
    }
    catch (err) {
        console.error('❌ Erreur lors de la récupération IP info:', err);
        return res.status(500).json({ error: "Impossible d'obtenir les infos IP." });
    }
});
exports.default = router;
