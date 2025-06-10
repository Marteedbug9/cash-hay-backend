// src/middlewares/verifyMember.ts
import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';

export const verifyMember = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentification requise." });
    }

    // Vérifie via users.member_id
    const { rows } = await pool.query(
      'SELECT member_id FROM users WHERE id = $1',
      [userId]
    );
    const hasMemberId = rows[0]?.member_id !== null && rows[0]?.member_id !== undefined && rows[0]?.member_id !== '';

    if (!hasMemberId) {
      return res.status(403).json({ error: "Vous devez être membre Cash Hay." });
    }
    next();
  } catch (err) {
    console.error('❌ Erreur verifyMember:', err);
    return res.status(500).json({ error: 'Erreur serveur de vérification membership.' });
  }
};
