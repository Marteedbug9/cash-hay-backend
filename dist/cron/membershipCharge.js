"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = __importDefault(require("../config/db"));
const runMembershipCharge = async () => {
    const client = await db_1.default.connect();
    try {
        const res = await db_1.default.query(`
  SELECT c.id AS card_id, c.user_id, users.balance
  FROM cards c
  JOIN users ON c.user_id = users.id
  WHERE c.status = 'active'
    AND c.created_at <= NOW() - INTERVAL '48 hours'
`);
        for (const card of res.rows) {
            if (card.balance < 25) {
                console.log(`Utilisateur ${card.user_id} n'a pas assez de solde.`);
                continue;
            }
            // Déduire 25 HTG de l'utilisateur
            await client.query('UPDATE users SET balance = balance - 25 WHERE id = $1', [card.user_id]);
            // Créditer le compte admin
            const adminRes = await client.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
            const adminId = adminRes.rows[0]?.id;
            if (adminId) {
                await client.query('UPDATE users SET balance = balance + 25 WHERE id = $1', [adminId]);
            }
            // Historique de transaction
            await client.query(`
        INSERT INTO transactions(user_id, amount, type, description)
        VALUES ($1, 25, 'debit', '25 HTG pour membership card début par Cash Hay')
      `, [card.user_id]);
            // Mettre la carte à active
            await client.query('UPDATE cards SET status = $1 WHERE id = $2', ['active', card.id]);
            console.log(`✅ Carte activée et 25 HTG déduits pour utilisateur ${card.user_id}`);
        }
    }
    catch (error) {
        console.error('Erreur lors du traitement des cartes :', error);
    }
    finally {
        client.release();
    }
};
runMembershipCharge();
