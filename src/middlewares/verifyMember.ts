// src/middlewares/verifyMember.ts
import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';

export const verifyMember = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentification requise." });
    }

    const result = await pool.query('SELECT id FROM members WHERE user_id = $1', [userId]);
    if (result.rowCount === 0) {
      return res.status(403).json({ error: "Vous devez être membre Cash Hay." });
    }
    next();
  } catch (err) {
    console.error('❌ Erreur verifyMember:', err);
    return res.status(500).json({ error: 'Erreur serveur de vérification membership.' });
  }
};
