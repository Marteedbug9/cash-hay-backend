// src/controllers/transactionController.ts
import { Request, Response } from 'express';
import pool from '../config/db';
import { v4 as uuidv4 } from 'uuid';
import PDFDocument from 'pdfkit';


export const getTransactions = async (req: Request, res: Response) => {
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

export const createTransaction = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const {
    type, // 'deposit', 'transfer', 'receive'
    amount,
    currency = 'HTG',
    description,
    recipient_id, // uuid de l’utilisateur cible
    source = 'manual'
  } = req.body;

  if (!type || !amount || isNaN(amount)) {
    return res.status(400).json({ error: 'Type et montant requis.' });
  }

  try {
    // Vérification si recipient_id existe dans le cas d’un transfert
    if (type === 'transfer') {
      if (!recipient_id) {
        return res.status(400).json({ error: 'recipient_id requis pour un transfert.' });
      }

      const checkRecipient = await pool.query(
        `SELECT id FROM users WHERE id = $1`,
        [recipient_id]
      );

      if (checkRecipient.rowCount === 0) {
        return res.status(404).json({ error: 'Bénéficiaire introuvable.' });
      }
    }

    // Enregistrement de la transaction
    await pool.query(
      `INSERT INTO transactions (
        user_id, type, amount, currency, recipient_id, source, description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, type, amount, currency, recipient_id || null, source, description]
    );

    // Mise à jour du solde
    if (type === 'deposit' || type === 'receive') {
      await pool.query(
        `UPDATE balances SET balance = balance + $1 WHERE user_id = $2`,
        [amount, userId]
      );
    }

    if (type === 'transfer' && recipient_id) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Débit expéditeur
        await client.query(
          `UPDATE balances SET balance = balance - $1 WHERE user_id = $2`,
          [amount, userId]
        );

        // Crédit bénéficiaire
        await client.query(
          `UPDATE balances SET balance = balance + $1 WHERE user_id = $2`,
          [amount, recipient_id]
        );

        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }
    }

    res.status(201).json({ message: 'Transaction réussie.' });
  } catch (err) {
    console.error('❌ Erreur transaction:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

export const deposit = async (req: Request, res: Response) => {
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

export const withdraw = async (req: Request, res: Response) => {
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

export const transfer = async (req: Request, res: Response)=> {
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

export const getBalance = async (req: Request, res: Response) => {
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

export const requestMoney = async (req: Request, res: Response) => {
  const requesterId = req.user?.id;
  const { recipientUsername, amount } = req.body;

  if (!recipientUsername || !amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Données invalides.' });
  }

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Vérifie que le destinataire existe
      const recipientRes = await client.query(
        'SELECT id FROM users WHERE username = $1',
        [recipientUsername]
      );

      if (recipientRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Destinataire introuvable.' });
      }

      const recipientId = recipientRes.rows[0].id;

      // Vérifie que le destinataire est membre
      const memberCheck = await client.query(
        `SELECT id FROM members WHERE contact = $1`,
        [recipientUsername]
      );

      if (memberCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Ce destinataire n’est pas encore membre Cash Hay.' });
      }

      const memberId = memberCheck.rows[0].id;

      // Enregistrement de la demande dans la table transactions
      await client.query(
        `INSERT INTO transactions (id, user_id, type, amount, currency, recipient_id, member_id, source, status, created_at)
         VALUES ($1, $2, 'request', $3, 'HTG', $4, $5, 'app', 'pending', NOW())`,
        [uuidv4(), requesterId, amount, recipientId, memberId]
      );

      await client.query('COMMIT');
      res.status(200).json({ message: 'Demande d’argent enregistrée avec succès.' });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('❌ Erreur requestMoney:', err);
    res.status(500).json({ error: 'Erreur serveur lors de la demande.' });
  }
};

export const acceptRequest = async (req: Request, res: Response) => {
  const payerId = req.user?.id;
  const { transactionId } = req.body;
  const transferFee = 0.57;

  if (!transactionId) {
    return res.status(400).json({ error: 'ID de la demande requis.' });
  }

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Récupère la demande
      const txRes = await client.query(
        `SELECT * FROM transactions WHERE id = $1 AND type = 'request' AND status = 'pending'`,
        [transactionId]
      );

      if (txRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Demande introuvable ou déjà traitée.' });
      }

      const requestTx = txRes.rows[0];

      // Vérifie que c’est bien le destinataire qui accepte
      if (requestTx.recipient_id !== payerId) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Non autorisé à accepter cette demande.' });
      }

      const amount = parseFloat(requestTx.amount);
      const requesterId = requestTx.user_id;

      // Vérifie le solde du payeur
      const balanceRes = await client.query(
        'SELECT balance FROM balances WHERE user_id = $1 FOR UPDATE',
        [payerId]
      );
      const payerBalance = parseFloat(balanceRes.rows[0]?.balance || '0');

      if (payerBalance < amount + transferFee) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Fonds insuffisants pour accepter la demande.' });
      }

      // Débit du payeur
      await client.query(
        `UPDATE balances SET balance = balance - $1 WHERE user_id = $2`,
        [amount + transferFee, payerId]
      );

      // Crédit du demandeur
      await client.query(
        `UPDATE balances SET balance = balance + $1 WHERE user_id = $2`,
        [amount, requesterId]
      );

      // Mise à jour de la demande initiale
      await client.query(
        `UPDATE transactions SET status = 'completed', updated_at = NOW() WHERE id = $1`,
        [transactionId]
      );

      // Enregistrement d’un nouveau transfert (acceptation)
      await client.query(
        `INSERT INTO transactions (id, user_id, type, amount, currency, recipient_id, member_id, source, status, description, created_at)
         VALUES ($1, $2, 'transfer', $3, 'HTG', $4, $5, 'app', 'completed', 'Paiement suite à une demande', NOW())`,
        [
          uuidv4(),
          payerId,
          amount,
          requesterId,
          requestTx.member_id || null
        ]
      );

      // Frais vers admin
      const adminId = process.env.ADMIN_USER_ID || 'admin-id-123';
      await client.query(
        `UPDATE balances SET balance = balance + $1 WHERE user_id = $2`,
        [transferFee, adminId]
      );
      await client.query(
        `INSERT INTO transactions (id, user_id, type, amount, currency, recipient_id, source, status, description, created_at)
         VALUES ($1, $2, 'fee', $3, 'HTG', $4, 'fee', 'completed', 'Frais suite à une demande', NOW())`,
        [uuidv4(), payerId, transferFee, adminId]
      );

      await client.query('COMMIT');
      res.status(200).json({ message: 'Demande acceptée avec succès.' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('❌ Erreur acceptRequest :', err);
    res.status(500).json({ error: 'Erreur serveur lors de l’acceptation.' });
  }
};

export const cancelRequest = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { transactionId } = req.body;

  if (!transactionId) {
    return res.status(400).json({ error: 'ID de la demande requis.' });
  }

  try {
    const result = await pool.query(
      `SELECT * FROM transactions WHERE id = $1 AND type = 'request' AND status = 'pending'`,
      [transactionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Demande introuvable ou déjà traitée.' });
    }

    const tx = result.rows[0];

    if (tx.user_id !== userId) {
      return res.status(403).json({ error: 'Vous ne pouvez annuler que vos propres demandes.' });
    }

    await pool.query(
      `UPDATE transactions SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [transactionId]
    );

    res.status(200).json({ message: 'Demande annulée avec succès.' });
  } catch (error) {
    console.error('❌ Erreur cancelRequest :', error);
    res.status(500).json({ error: 'Erreur serveur lors de l’annulation.' });
  }
};

export const getRequests = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { direction } = req.query; // direction = 'sent' ou 'received'

  if (!['sent', 'received'].includes(direction as string)) {
    return res.status(400).json({ error: "Paramètre 'direction' invalide. Utilisez 'sent' ou 'received'." });
  }

  const field = direction === 'sent' ? 'user_id' : 'recipient_id';

  try {
    const result = await pool.query(
      `
      SELECT t.id, t.amount, t.currency, t.status, t.created_at,
             u.username AS other_party_username,
             u.profile_image AS other_party_image,
             t.description
      FROM transactions t
      JOIN users u ON u.id = (CASE WHEN $1 = 'user_id' THEN t.recipient_id ELSE t.user_id END)
      WHERE t.type = 'request' AND t.${field} = $2
      ORDER BY t.created_at DESC
      `,
      [field, userId]
    );

    return res.status(200).json({ requests: result.rows });
  } catch (error) {
    console.error('❌ Erreur getRequests :', error);
    return res.status(500).json({ error: 'Erreur serveur lors de la récupération des demandes.' });
  }
};

export const getMonthlyStatement = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { month } = req.query; // ex: "2024-06"
  if (!month) {
    return res.status(400).json({ error: 'Paramètre "month" requis (YYYY-MM)' });
  }

  // Calcule les bornes de dates
  const monthStart = `${month}-01`;
  const nextMonth = new Date(monthStart);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const monthEnd = nextMonth.toISOString().split('T')[0];

  try {
    const transactionsResult = await pool.query(
      `SELECT * FROM transactions 
       WHERE user_id = $1 
         AND created_at >= $2
         AND created_at < $3
       ORDER BY created_at ASC`,
      [userId, monthStart, monthEnd]
    );
    const transactions = transactionsResult.rows;

    const sumResult = await pool.query(
      `SELECT SUM(
         CASE WHEN type IN ('deposit', 'receive', 'request_recharge_accepted') THEN amount
              WHEN type IN ('withdraw', 'transfer', 'card_payment', 'fee') THEN -amount
              ELSE 0 END
        ) AS total
        FROM transactions
        WHERE user_id = $1
          AND created_at >= $2
          AND created_at < $3`,
      [userId, monthStart, monthEnd]
    );
    const total = sumResult.rows[0]?.total || 0;

    // PDF - commence à pipe APRÈS toutes les erreurs potentielles
    const doc = new PDFDocument();
    res.setHeader('Content-type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="statement-${month}.pdf"`);
    doc.pipe(res);

    doc.fontSize(18).text(`Relevé de Compte - ${month}`, { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Utilisateur: ${req.user?.username || userId}`);
    doc.moveDown();
    doc.text('Transactions :');
    doc.moveDown();

    transactions.forEach(tx => {
      doc.text(
        `${tx.created_at} | ${tx.type} | ${tx.amount} HTG | statut: ${tx.status} | ${tx.description || ''}`
      );
    });

    doc.moveDown();
    doc.fontSize(14).text(`Total net du mois : ${total} HTG`, { align: 'right' });

    doc.end();
  } catch (err) {
    // S'IL Y A ERREUR, renvoie du JSON uniquement si tu n’as pas encore fait pipe sur res
    // Si le PDF a déjà commencé à s'écrire, tu ne peux plus envoyer du JSON proprement !
    console.error('❌ Erreur statement:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erreur serveur.' });
    } else {
      // Optionnel: ferme le stream et laisse le client gérer l’erreur PDF côté front
      res.end();
    }
  }
};
