// src/controllers/transactionController.ts
import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../types/AuthenticatedRequest'; // ✅

import pool from '../config/db';
import { v4 as uuidv4 } from 'uuid';


export const getTransactions = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;

  try {
    const result = await pool.query(
      `SELECT * FROM transactions 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    );
    res.json({ transactions: result.rows });
  } catch (err) {
    console.error('❌ Erreur transactions:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

export const createTransaction = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  const {
    type, // 'deposit', 'transfer', 'receive'
    amount,
    currency = 'HTG',
    description,
    recipient_email,
    recipient_phone,
    source = 'manual'
  } = req.body;

  if (!type || !amount || isNaN(amount)) {
    return res.status(400).json({ error: 'Type et montant requis.' });
  }

  try {
    let recipientId: string | null = null;

    if (type === 'transfer' && (recipient_email || recipient_phone)) {
      const recipientRes = await pool.query(
        `SELECT id FROM users WHERE email = $1 OR phone = $2`,
        [recipient_email, recipient_phone]
      );

      if (recipientRes.rows.length === 0) {
        return res.status(404).json({ error: 'Bénéficiaire introuvable.' });
      }

      recipientId = recipientRes.rows[0].id;
    }

    // ✅ Enregistrer la transaction
    await pool.query(
      `INSERT INTO transactions (
        user_id, type, amount, currency, recipient_id, recipient_email, recipient_phone, source, description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [userId, type, amount, currency, recipientId, recipient_email, recipient_phone, source, description]
    );

    // ✅ Mettre à jour le solde
    if (type === 'deposit' || type === 'receive') {
      await pool.query(
        `UPDATE balances SET balance = balance + $1 WHERE user_id = $2`,
        [amount, userId]
      );
    }

    if (type === 'transfer' && recipientId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Débit de l'expéditeur
        await client.query(
          `UPDATE balances SET balance = balance - $1 WHERE user_id = $2`,
          [amount, userId]
        );

        // Crédit du bénéficiaire
        await client.query(
          `UPDATE balances SET balance = balance + $1 WHERE user_id = $2`,
          [amount, recipientId]
        );

        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }
    }

    res.status(201).json({ message: 'Transaction enregistrée et solde mis à jour.' });
  } catch (err) {
    console.error('❌ Erreur transaction:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

export const deposit = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  const { amount, source = 'manual', currency = 'HTG' } = req.body;

  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Montant invalide.' });
  }

  try {
    const client = await pool.connect();
    await client.query('BEGIN');

    // ➔ Mise à jour du solde
    await client.query(
      `UPDATE balances SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2`,
      [amount, userId]
    );

    // ➔ Insertion de la transaction
    await client.query(
      `INSERT INTO transactions (id, user_id, type, amount, currency, source, status, created_at)
       VALUES ($1, $2, 'deposit', $3, $4, $5, 'completed', NOW())`,
      [uuidv4(), userId, amount, currency, source]
    );

    await client.query('COMMIT');
    client.release();

    res.status(200).json({ message: 'Dépôt effectué avec succès.', amount });
  } catch (error: any) {
    console.error('❌ Erreur dépôt :', error.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

export const withdraw = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  const { amount, currency = 'HTG', source = 'manual' } = req.body;

  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Montant invalide.' });
  }

  try {
    const client = await pool.connect();
    await client.query('BEGIN');

    // Vérifie le solde avant de retirer
    const balanceResult = await client.query(
      `SELECT balance FROM balances WHERE user_id = $1`,
      [userId]
    );

    const currentBalance = balanceResult.rows[0]?.balance || 0;
    if (currentBalance < amount) {
      client.release();
      return res.status(400).json({ error: 'Fonds insuffisants.' });
    }

    // Mise à jour du solde
    await client.query(
      `UPDATE balances SET balance = balance - $1, updated_at = NOW() WHERE user_id = $2`,
      [amount, userId]
    );

    // Insertion de la transaction
    await client.query(
      `INSERT INTO transactions (id, user_id, type, amount, currency, source, status, created_at)
       VALUES ($1, $2, 'withdraw', $3, $4, $5, 'completed', NOW())`,
      [uuidv4(), userId, amount, currency, source]
    );

    await client.query('COMMIT');
    client.release();

    res.status(200).json({ message: 'Retrait effectué avec succès.', amount });
  } catch (error: any) {
    console.error('❌ Erreur retrait :', error.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

export const transfer = async (req: AuthenticatedRequest, res: Response) => {
  const senderId = req.user?.id;
  const { recipientUsername, amount } = req.body;
  const transferFee = 0.57;

  if (!recipientUsername || !amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Données invalides.' });
  }

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const weeklyTotalResult = await client.query(
        `SELECT SUM(amount) as total FROM transactions
         WHERE user_id = $1 AND type = 'transfer' AND created_at >= $2`,
        [senderId, weekAgo]
      );

      const weeklyTotal = parseFloat(weeklyTotalResult.rows[0]?.total || '0');
      if (weeklyTotal + amount > 100000) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Limite hebdomadaire de 100 000 HTG dépassée.' });
      }

      const senderBalanceRes = await client.query(
        'SELECT balance FROM balances WHERE user_id = $1 FOR UPDATE',
        [senderId]
      );
      const senderBalance = parseFloat(senderBalanceRes.rows[0]?.balance || '0');
      if (senderBalance < amount + transferFee) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Fonds insuffisants (incluant les frais).' });
      }

      const recipientRes = await client.query(
        'SELECT id FROM users WHERE username = $1',
        [recipientUsername]
      );
      if (recipientRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Destinataire introuvable.' });
      }
      const recipientId = recipientRes.rows[0].id;

      await client.query(
        'UPDATE balances SET balance = balance - $1 WHERE user_id = $2',
        [amount + transferFee, senderId]
      );

      await client.query(
        'UPDATE balances SET balance = balance + $1 WHERE user_id = $2',
        [amount, recipientId]
      );

      await client.query(
        `INSERT INTO transactions (id, user_id, type, amount, currency, recipient_id, source, status, created_at)
         VALUES ($1, $2, 'transfer', $3, 'HTG', $4, 'app', 'completed', NOW())`,
        [uuidv4(), senderId, amount, recipientId]
      );

      const adminId = process.env.ADMIN_USER_ID || 'admin-id-123';
      await client.query(
        `UPDATE balances SET balance = balance + $1 WHERE user_id = $2`,
        [transferFee, adminId]
      );
      await client.query(
        `INSERT INTO transactions (id, user_id, type, amount, currency, recipient_id, source, status, description, created_at)
         VALUES ($1, $2, 'fee', $3, 'HTG', $4, 'fee', 'completed', 'Frais de transfert', NOW())`,
        [uuidv4(), senderId, transferFee, adminId]
      );

      await client.query('COMMIT');
      res.status(200).json({ message: 'Transfert effectué avec succès.' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('❌ Erreur transfer:', err);
    res.status(500).json({ error: 'Erreur serveur lors du transfert.' });
  }
};

export const getBalance = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;

  try {
    const result = await pool.query(
      'SELECT amount FROM balances WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Solde non trouvé." });
    }

    res.json({ balance: parseFloat(result.rows[0].amount) });
  } catch (err) {
    console.error('❌ Erreur balance:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

export const updateBalance = async (userId: string, delta: number) => {
  await pool.query(
    `UPDATE balances 
     SET amount = amount + $1, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $2`,
    [delta, userId]
  );
};
