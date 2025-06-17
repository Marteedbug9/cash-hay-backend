import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';

export const verifyMember = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentification requise." });
    }

    // Vérifie que le user possède un member_id qui existe dans members
    const { rows } = await pool.query(
      `SELECT m.id AS member_id
         FROM users u
         JOIN members m ON u.member_id = m.id
        WHERE u.id = $1`,
      [userId]
    );

    if (!rows.length) {
      return res.status(403).json({ error: "Vous devez être membre Cash Hay." });
    }

    next(); // tout est bon, il est membre
  } catch (err) {
    console.error('❌ Erreur verifyMember:', err);
    return res.status(500).json({ error: 'Erreur serveur de vérification membership.' });
  }
};
