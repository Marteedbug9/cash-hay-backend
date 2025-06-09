"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelCard = exports.toggleCardLock = exports.requestCard = void 0;
const db_1 = __importDefault(require("../config/db"));
// 🟢 Demande de carte gratuite, paiement après 48h
const requestCard = async (req, res) => {
    const client = await db_1.default.connect();
    try {
        const userId = req.user?.id;
        // Vérifie si l'utilisateur a déjà une carte active ou en attente
        const existingCard = await client.query('SELECT * FROM cards WHERE user_id = $1 AND status IN ($2, $3)', [userId, 'pending', 'active']);
        if (existingCard.rows.length > 0) {
            return res.status(400).json({ error: "Vous avez déjà une carte active ou en attente." });
        }
        // Enregistrement de la carte gratuite, le paiement sera différé
        await client.query('INSERT INTO cards (user_id, status, is_locked, requested_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)', [userId, 'pending', false]);
        return res.json({
            message: "Carte demandée gratuitement. 25 HTG seront débités après 48h si elle est toujours active.",
        });
    }
    catch (err) {
        console.error('Erreur lors de la demande de carte :', err);
        return res.status(500).json({ error: 'Erreur serveur' });
    }
    finally {
        client.release();
    }
};
exports.requestCard = requestCard;
// 🔒 Verrouiller/déverrouiller la carte
const toggleCardLock = async (req, res) => {
    const userId = req.user?.id;
    const { is_locked } = req.body;
    await db_1.default.query('UPDATE cards SET is_locked = $1 WHERE user_id = $2', [is_locked, userId]);
    return res.json({ message: `Carte ${is_locked ? 'verrouillée' : 'déverrouillée'}` });
};
exports.toggleCardLock = toggleCardLock;
// ❌ Annuler la carte
const cancelCard = async (req, res) => {
    const userId = req.user?.id;
    await db_1.default.query('DELETE FROM cards WHERE user_id = $1', [userId]);
    return res.json({ message: 'Carte annulée' });
};
exports.cancelCard = cancelCard;
