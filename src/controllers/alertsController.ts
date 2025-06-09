import { Request, Response } from 'express';
import pool from '../config/db';

export const handleSMSReply = async (req: Request, res: Response) => {
  const from = req.body.From; // Le numéro de l'utilisateur
  const body = req.body.Body?.trim().toUpperCase(); // Réponse reçue : 'Y' ou 'N'

  try {
    if (body !== 'Y' && body !== 'N') {
      return res.status(200).send('<Response></Response>'); // Ne rien faire
    }

    // 🔍 Trouver le user par numéro
    const userRes = await pool.query(
      `SELECT id FROM users WHERE phone = $1`,
      [from]
    );

    if (userRes.rows.length === 0) {
      console.warn(`Numéro inconnu : ${from}`);
      return res.status(200).send('<Response></Response>');
    }

    const userId = userRes.rows[0].id;

    // 🔁 Mise à jour de la dernière alerte en attente
    await pool.query(
      `UPDATE alerts
       SET response = $1, raw_response = $2
       WHERE user_id = $3 AND response IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [body, body, userId]
    );

    res.status(200).send('<Response></Response>');
  } catch (err) {
    console.error('❌ Erreur handleSMSReply :', err);
    res.status(500).send('<Response></Response>');
  }
};
