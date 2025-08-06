import { Request, Response } from 'express';
import pool from '../config/db';
import { verifyToken  } from '../middlewares/verifyToken';

export const getAuthorizations = async (req:Request, res: Response) => {
  try {
    const userId = req.user?.id;

    const result = await pool.query(
      `SELECT
        id,
        marqeta_authorization_id,
        state,
        amount,
        currency,
        merchant,
        merchant_country,
        merchant_city,
        merchant_category,
        created_at
      FROM authorizations
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 100`,
      [userId]
    );

    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Erreur getAuthorizations:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};
