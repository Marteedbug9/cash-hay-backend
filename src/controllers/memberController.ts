import { Request, Response } from 'express';
import pool from '../config/db';

export const getMemberContact = async (req: Request, res: Response) => {
  const { memberId } = req.params;
  try {
    const result = await pool.query(
      'SELECT contact FROM members WHERE id = $1',
      [memberId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Membre introuvable.' });
    }
    res.json({ contact: result.rows[0].contact });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

