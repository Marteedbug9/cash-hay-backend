// src/controllers/transactionController.ts
import { Request, Response } from 'express';
import pool from '../config/db';
import { v4 as uuidv4 } from 'uuid';
import PDFDocument from 'pdfkit';
import { sendPushNotification,notifyUser, sendEmail, sendSMS } from '../utils/notificationUtils';
import { addNotification } from './notificationsController'; 
import stripe from '../config/stripe';
// En haut du fichier



export const getTransactions = async (req: Request, res: Response) => {
  console.log("✅ getTransactions appelé !");
  const userId = req.user?.id;

  try {
    // Toutes les transactions où l'utilisateur est soit expéditeur soit destinataire
    const result = await pool.query(
      `SELECT 
  t.id,
  t.user_id,
  t.type,
  t.amount,
  t.currency,
  t.status,
  t.description,
  t.recipient_id,
  t.created_at AS date,
  t.source,
  t.recipient_email,
  t.recipient_phone,
  u1.first_name AS sender_first_name,
  u1.last_name AS sender_last_name,
  u2.first_name AS recipient_first_name,
  u2.last_name AS recipient_last_name,
  COALESCE(b.name, 
    CASE 
      WHEN t.type IN ('send', 'transfer') AND u2.id IS NOT NULL
        THEN CONCAT(u2.first_name, ' ', u2.last_name)
      WHEN t.type = 'receive' AND u1.id IS NOT NULL
        THEN CONCAT(u1.first_name, ' ', u1.last_name)
      WHEN t.type = 'card_payment' AND t.description IS NOT NULL
        THEN t.description
      ELSE 'Cash Hay'
    END
  ) AS display_name,
  b.name AS business_name,
  b.type AS business_type,
  b.ip_address AS business_ip,
  u2.photo_url AS recipient_photo,
  u1.photo_url AS sender_photo,
  CASE
    WHEN t.user_id = $1 AND t.type IN ('send','transfer','withdraw','card_payment','fee') THEN 'out'
    WHEN t.recipient_id = $1 OR t.type IN ('receive','deposit') THEN 'in'
    ELSE NULL
  END AS direction
FROM transactions t
LEFT JOIN users u1 ON u1.id = t.user_id
LEFT JOIN users u2 ON u2.id = t.recipient_id
LEFT JOIN business b ON t.business_id = b.id
WHERE t.user_id = $1 OR t.recipient_id = $1
ORDER BY t.created_at DESC;
`,
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
    recipient_id,
    source = 'manual',
    business_id // <-- nouveau
  } = req.body;

  // 📥 Audit : récupère IP + user-agent
  const ip_address = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
  const user_agent = req.headers['user-agent'] || '';

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

    // Enregistrement de la transaction (ajout IP, User Agent et business_id)
    await pool.query(
      `INSERT INTO transactions (
        id, user_id, type, amount, currency, recipient_id, source, description, ip_address, user_agent, business_id, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'completed', NOW())`,
      [
        uuidv4(),
        userId,
        type,
        amount,
        currency,
        recipient_id || null,
        source,
        description,
        ip_address,
        user_agent,
        business_id || null // Ajout ici
      ]
    );

    // Mise à jour du solde (reprends ta logique métier)
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
        await client.query(
          `UPDATE balances SET balance = balance - $1 WHERE user_id = $2`,
          [amount, userId]
        );
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

    // Notification par email (idem)
    if (type === 'transfer' && recipient_id) {
      try {
        const destRes = await pool.query('SELECT email FROM users WHERE id = $1', [recipient_id]);
        const email = destRes.rows[0]?.email;
        if (email) {
          await sendEmail({ to: email, subject: "Transfert reçu - Cash Hay", text: `Vous avez reçu ${amount} HTG.` });
        }
      } catch (e) {
        console.log("Notification transfer: catch", e);
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
  const ip_address = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
  const user_agent = req.headers['user-agent'] || '';

  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Montant invalide.' });
  }

  try {
    const client = await pool.connect();
    await client.query('BEGIN');

    await client.query(
       `UPDATE balances SET amount = amount + $1, updated_at = NOW() WHERE user_id = $2`,
      [amount, userId]
    );
    const txId = uuidv4();
    await client.query(
      `INSERT INTO transactions (id, user_id, type, amount, currency, source, status, ip_address, user_agent, created_at)
       VALUES ($1, $2, 'deposit', $3, $4, $5, 'completed', $6, $7, NOW())`,
      [txId, userId, amount, currency, source, ip_address, user_agent]
    );

    // Ajoute dans audit_logs (bonus traçabilité)
    await client.query(
      `INSERT INTO audit_logs (id, user_id, action, ip_address, user_agent, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uuidv4(), userId, 'deposit', ip_address, user_agent, `Dépot de ${amount} ${currency}`]
    );

    await client.query('COMMIT');
    client.release();

    // Notification email après dépôt (asynchrone)
    try {
      const userRes = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
      const email = userRes.rows[0]?.email;
      if (email) {
        await sendEmail({ to: email, subject: "Dépôt confirmé - Cash Hay", text: `Votre dépôt de ${amount} HTG est crédité sur votre compte.` });
      }
    } catch (notifErr) {
      console.error("Erreur notif dépôt:", notifErr);
    }

    res.status(200).json({ message: 'Dépôt effectué avec succès.', amount });
  } catch (error: any) {
    console.error('❌ Erreur dépôt :', error.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};


export const withdraw = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { amount, currency = 'HTG', source = 'manual' } = req.body;
  const ip_address = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
  const user_agent = req.headers['user-agent'] || '';

  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Montant invalide.' });
  }

  try {
    const client = await pool.connect();
    await client.query('BEGIN');

    const balanceResult = await client.query(
      `SELECT balance FROM balances WHERE user_id = $1`,
      [userId]
    );
    const currentBalance = balanceResult.rows[0]?.balance || 0;
    if (currentBalance < amount) {
      client.release();
      return res.status(400).json({ error: 'Fonds insuffisants.' });
    }

    await client.query(
      `UPDATE balances SET balance = balance - $1, updated_at = NOW() WHERE user_id = $2`,
      [amount, userId]
    );
    const txId = uuidv4();
    await client.query(
      `INSERT INTO transactions (id, user_id, type, amount, currency, source, status, ip_address, user_agent, created_at)
       VALUES ($1, $2, 'withdraw', $3, $4, $5, 'completed', $6, $7, NOW())`,
      [txId, userId, amount, currency, source, ip_address, user_agent]
    );

    // Ajoute dans audit_logs (bonus traçabilité)
    await client.query(
      `INSERT INTO audit_logs (id, user_id, action, ip_address, user_agent, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uuidv4(), userId, 'withdraw', ip_address, user_agent, `Retrait de ${amount} ${currency}`]
    );

    await client.query('COMMIT');
    client.release();

    // Notification email après retrait
    try {
      const userRes = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
      const email = userRes.rows[0]?.email;
      if (email) {
        await sendEmail({ to: email, subject: "Retrait effectué - Cash Hay", text: `Vous avez retiré ${amount} HTG de votre compte.` });
      }
    } catch (notifErr) {
      console.error("Erreur notif retrait:", notifErr);
    }

    res.status(200).json({ message: 'Retrait effectué avec succès.', amount });
  } catch (error: any) {
    console.error('❌ Erreur retrait :', error.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

export const transfer = async (req: Request, res: Response) => {
  const senderId = req.user?.id;
  const { recipientUsername, amount } = req.body;
  const transferFee = 0.57;
  const ip_address = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
  const user_agent = req.headers['user-agent'] || '';

  if (!recipientUsername || !amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Données invalides.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Recherche du destinataire (email ou téléphone)
    const cleanedContact = recipientUsername.trim().toLowerCase();
    let memberRes;
    if (cleanedContact.includes('@')) {
      memberRes = await client.query(
        'SELECT id FROM members WHERE LOWER(contact) = $1',
        [cleanedContact]
      );
    } else {
      const digits = cleanedContact.replace(/\D/g, '');
      memberRes = await client.query(
        `SELECT id FROM members
         WHERE
           REPLACE(REPLACE(REPLACE(contact, '+', ''), ' ', ''), '-', '') = $1
           OR RIGHT(REPLACE(REPLACE(REPLACE(contact, '+', ''), ' ', ''), '-', ''), 8) = $2`,
        [digits, digits.slice(-8)]
      );
    }

    if (!memberRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Destinataire introuvable ou non inscrit.' });
    }
    const memberId = memberRes.rows[0].id;
    const recipientUserRes = await client.query(
      'SELECT id, first_name, last_name FROM users WHERE member_id = $1',
      [memberId]
    );
    if (!recipientUserRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Aucun utilisateur lié à ce membre.' });
    }
    const recipientId = recipientUserRes.rows[0].id;

    // Empêcher auto-transfert
    if (recipientId === senderId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Impossible de vous envoyer de l’argent à vous-même.' });
    }

    // Vérifie la carte Stripe du sender
    const senderCardRes = await client.query(
      'SELECT stripe_card_id FROM cards WHERE user_id = $1 AND status = $2 LIMIT 1',
      [senderId, 'active']
    );
    // La carte Stripe n’est **pas utilisée ici** mais tu peux la logger pour vérification/audit
    const senderStripeCardId = senderCardRes.rows[0]?.stripe_card_id ?? null;

    // Vérifie balance + frais (wallet interne)
    const senderBalanceRes = await client.query(
      'SELECT amount FROM balances WHERE user_id = $1 FOR UPDATE',
      [senderId]
    );
    const senderBalance = parseFloat(senderBalanceRes.rows[0]?.amount || '0');
    if (senderBalance < amount + transferFee) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Fonds insuffisants (incluant les frais).' });
    }

    // 1️⃣ --- Wallet internes (débit/crédit local) ---
    await client.query(
      'UPDATE balances SET amount = amount - $1 WHERE user_id = $2',
      [amount + transferFee, senderId]
    );
    await client.query(
      'UPDATE balances SET amount = amount + $1 WHERE user_id = $2',
      [amount, recipientId]
    );

    // 2️⃣ --- Transaction principale ---
    const txId = uuidv4();
    await client.query(
  `INSERT INTO transactions (
      id, user_id, type, amount, currency, recipient_id, member_id, source, status, ip_address, user_agent, created_at
    ) VALUES (
      $1, $2, 'transfer', $3, 'HTG', $4, $5, 'stripe_issuing', 'waiting_stripe', $6, $7, NOW()
    )`,
  [txId, senderId, amount, recipientId, memberId, ip_address, user_agent]
);



    // 3️⃣ --- Audit log interne ---
    await client.query(
      `INSERT INTO audit_logs (id, user_id, action, ip_address, user_agent, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uuidv4(), senderId, 'transfer', ip_address, user_agent, `Transfert de ${amount} HTG à ${recipientId}`]
    );

    // 4️⃣ --- Frais admin ---
    const adminId = process.env.ADMIN_USER_ID || 'admin-id-123';
    await client.query(
      'UPDATE balances SET amount = amount + $1 WHERE user_id = $2',
      [transferFee, adminId]
    );
    await client.query(
      `INSERT INTO transactions (id, user_id, type, amount, currency, recipient_id, source, status, description, ip_address, user_agent, created_at)
       VALUES ($1, $2, 'fee', $3, 'HTG', $4, 'fee', 'completed', 'Frais de transfert', $5, $6, NOW())`,
      [uuidv4(), senderId, transferFee, adminId, ip_address, user_agent]
    );

    await client.query('COMMIT');

    // 5️⃣ --- Email destinataire (asynchrone) ---
   pool.query('SELECT email, phone, expo_push_token, first_name FROM users WHERE id = $1', [recipientId])
      .then(async res => {
        const { email, phone, expo_push_token, first_name } = res.rows[0] || {};
        await notifyUser({
          expoPushToken: expo_push_token,
          email,
          phone,
          title: 'Transfert reçu',
          body: `Bonjour${first_name ? ' ' + first_name : ''}, vous avez reçu ${amount} HTG via Cash Hay.`,
          subject: 'Transfert reçu - Cash Hay',
          sms: `Vous avez reçu ${amount} HTG via Cash Hay.`,
        });
      })
      .catch(e => {
        console.error('Erreur notification destinataire:', e);
      });

    return res.status(200).json({ 
      message: 'Transfert effectué avec succès.',
      tx_id: txId
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur lors du transfert:', error);
    return res.status(500).json({ error: 'Erreur serveur lors du transfert.' });
  } finally {
    client.release();
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

    res.json({ balance: parseFloat(result.rows[0].amount) }); // <-- amount = balance officiel
  } catch (err) {
    console.error('❌ Erreur balance:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};


export const updateBalance = async (userId: string, delta: number) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1️⃣ Met à jour le wallet interne (SQL)
    await client.query(
      `UPDATE balances 
       SET amount = amount + $1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2`,
      [delta, userId]
    );

    // 2️⃣ Cherche la carte Stripe active du user (pour audit, logs, etc)
    const cardRes = await client.query(
      'SELECT stripe_card_id FROM cards WHERE user_id = $1 AND status = $2 LIMIT 1',
      [userId, 'active']
    );
    if (!cardRes.rows.length) throw new Error('No active Stripe card.');
    const stripeCardId = cardRes.rows[0].stripe_card_id;

    // 3️⃣ (Optionnel) Trace l’intention de synchronisation Stripe pour un débit
    if (delta < 0) {
      const amountInCents = Math.abs(Math.round(delta * 100));
      // Ici tu LOGGES juste l’intention pour audit/rapprochement avec Stripe (pas de call API)
      await client.query(
        `INSERT INTO audit_logs (user_id, action, details, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [
          userId,
          'debit_intent',
          `Intention de débit Stripe Issuing: ${amountInCents} cents sur card ${stripeCardId}`
        ]
      );
      // La vraie transaction carte sera faite côté Stripe (via webhook, réel achat, etc)
    }

    // 4️⃣ Commit si tout OK
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};


export const requestMoney = async (req: Request, res: Response) => {
  const requesterId = req.user?.id;
  const { recipientUsername, amount } = req.body;
  const ip_address = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
  const user_agent = req.headers['user-agent'] || '';
  const cleanedContact = recipientUsername.trim().toLowerCase();

  if (!recipientUsername || !amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Données invalides.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Trouver le membre destinataire
    let memberRes;
    if (cleanedContact.includes('@')) {
      memberRes = await client.query(
        'SELECT id FROM members WHERE LOWER(contact) = $1',
        [cleanedContact]
      );
    } else {
      const digits = cleanedContact.replace(/\D/g, '');
      memberRes = await client.query(
        `SELECT id FROM members
         WHERE 
           REPLACE(REPLACE(REPLACE(contact, '+', ''), ' ', ''), '-', '') = $1
           OR RIGHT(REPLACE(REPLACE(REPLACE(contact, '+', ''), ' ', ''), '-', ''), 8) = $2`,
        [digits, digits.slice(-8)]
      );
    }

    if (!memberRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Destinataire introuvable ou non inscrit.' });
    }
    const memberId = memberRes.rows[0].id;

    // Trouver le user destinataire
    const recipientUserRes = await client.query(
      'SELECT id, first_name, last_name FROM users WHERE member_id = $1',
      [memberId]
    );
    if (!recipientUserRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Aucun utilisateur lié à ce membre.' });
    }
    const recipientId = recipientUserRes.rows[0].id;

    // Empêcher auto-demande
    if (recipientId === requesterId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Impossible de vous faire une demande à vous-même.' });
    }

    // Transaction "pending"
    const txId = uuidv4();
    await client.query(
      `INSERT INTO transactions (id, user_id, type, amount, currency, recipient_id, member_id, source, status, ip_address, user_agent, created_at)
       VALUES ($1, $2, 'request', $3, 'HTG', $4, $5, 'app', 'pending', $6, $7, NOW())`,
      [txId, requesterId, amount, recipientId, memberId, ip_address, user_agent]
    );

    // Audit log
    await client.query(
      `INSERT INTO audit_logs (id, user_id, action, ip_address, user_agent, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uuidv4(), requesterId, 'request_money', ip_address, user_agent, `Demande d’argent de ${amount} HTG à ${recipientId}`]
    );

    // Notification (pour le recipient)
    await client.query(
      `INSERT INTO notifications (
        user_id, type, from_first_name, from_last_name, from_contact, from_profile_image, amount, status, transaction_id
      )
       SELECT $1, 'request', u.first_name, u.last_name, u.username, u.photo_url, $2, 'pending', $3
       FROM users u WHERE u.id = $4`,
      [recipientId, amount, txId, requesterId]
    );

    await client.query('COMMIT');

    // Email destinataire (asynchrone)
    pool.query('SELECT email FROM users WHERE id = $1', [recipientId])
      .then(recipientRes => {
        const email = recipientRes.rows[0]?.email;
        if (email) {
          sendEmail({
            to: email,
            subject: "Demande d’argent Cash Hay",
            text: `Vous avez reçu une demande d’argent de ${amount} HTG sur Cash Hay.`
          });
        }
      })
      .catch(notifErr => {
        console.error('Erreur notification request:', notifErr);
      });

    return res.status(200).json({ message: 'Demande d’argent enregistrée avec succès.' });

  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'Erreur serveur lors de la demande.' });
  } finally {
    client.release();
  }
};



export const acceptRequest = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { id } = req.params; // notification id

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1️⃣ Récupérer la notification
    const notifRes = await client.query(
      `SELECT * FROM notifications WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
      [id, userId]
    );
    const notification = notifRes.rows[0];
    if (!notification) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Demande introuvable ou déjà traitée.' });
    }
    const { transaction_id, amount } = notification;

    // 2️⃣ Récupérer la transaction
    const txRes = await client.query(
      `SELECT * FROM transactions WHERE id = $1 AND status = 'pending'`,
      [transaction_id]
    );
    const transaction = txRes.rows[0];
    if (!transaction) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Transaction introuvable ou déjà traitée.' });
    }

    // 3️⃣ Vérifier le solde interne (en attente de débit Stripe pour verrouiller)
    const balanceRes = await client.query(
      `SELECT amount FROM balances WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    const currentBalance = parseFloat(balanceRes.rows[0]?.amount || '0');
    const tax = 0.57;
    const totalToDeduct = parseFloat(amount) + tax;
    if (currentBalance < totalToDeduct) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Solde insuffisant. Vous avez ${currentBalance} HTG mais ${totalToDeduct} HTG est requis.`,
      });
    }

    // 4️⃣ Chercher la carte Stripe active du payeur
    const cardRes = await client.query(
      'SELECT stripe_card_id FROM cards WHERE user_id = $1 AND status = $2 LIMIT 1',
      [userId, 'active']
    );
    if (!cardRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: "Aucune carte Stripe active trouvée." });
    }
    const stripeCardId = cardRes.rows[0].stripe_card_id;

    // 5️⃣ Stripe Issuing Authorization (débit à confirmer dans webhook)
    let authorizationId: string | null = null;
    try {
      // On utilise stripe.issuing.authorizations.create SEULEMENT si supporté par ta version Stripe !
      // Si tu as l’erreur “create does not exist”, il faut juste ENREGISTRER l’intention dans ta BDD
      // et laisser Stripe t’envoyer le webhook (dans ce cas, ne pas appeler la méthode ici).
      // Ici, on IMITE l’appel Stripe, sinon saute cette étape.

      // await stripe.issuing.authorizations.create({
      //   amount: Math.round(parseFloat(amount) * 100),
      //   currency: 'usd',
      //   card: stripeCardId,
      //   merchant_data: {
      //     merchant_category_code: '4829',
      //     name: "Cash Hay P2P Request",
      //   },
      // });
      // authorizationId = authorization.id;

      // Tu peux aussi juste enregistrer dans la transaction qu'on attend un paiement Stripe (sans appeler l'API ici)
      authorizationId = null;
    } catch (stripeErr) {
      await client.query('ROLLBACK');
      console.error('❌ Stripe Issuing error:', stripeErr);
      return res.status(400).json({ error: "Paiement refusé par Stripe.", stripe_error: (stripeErr as Error).message });
    }

    // 6️⃣ Mettre à jour les statuts BDD → toujours “pending” tant que Stripe n’a pas confirmé
    await client.query(
      `UPDATE notifications SET status = 'waiting_stripe', updated_at = NOW() WHERE id = $1`,
      [id]
    );
    await client.query(
      `UPDATE transactions SET status = 'waiting_stripe', stripe_authorization_id = $2 WHERE id = $1`,
      [transaction_id, authorizationId]
    );

    await client.query('COMMIT');

    res.json({
      message: 'Paiement en cours de traitement. Le bénéficiaire sera crédité dès validation Stripe.',
      stripe_authorization_id: authorizationId
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur acceptRequest :', err);
    res.status(500).json({ error: 'Erreur lors de l’acceptation de la demande.' });
  } finally {
    client.release();
  }
};



export const cancelRequest = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { id } = req.params;

  try {
    const notifRes = await pool.query(
      `SELECT * FROM notifications WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
      [id, userId]
    );
    const notification = notifRes.rows[0];

    if (!notification) {
      return res.status(404).json({ error: 'Demande introuvable ou déjà traitée.' });
    }

    const { transaction_id } = notification;

    // ❌ Mettre à jour le statut dans notifications
    await pool.query(
      `UPDATE notifications SET status = 'cancelled' WHERE id = $1`,
      [id]
    );

    // ❌ Mettre à jour le statut dans transactions
    await pool.query(
      `UPDATE transactions SET status = 'cancelled' WHERE id = $1`,
      [transaction_id]
    );

    res.json({ message: 'Demande annulée avec succès.' });

  } catch (err) {
    console.error('❌ Erreur cancelRequest :', err);
    res.status(500).json({ error: 'Erreur lors de l’annulation.' });
  }
};



export const getMonthlyStatement = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { month } = req.query; // ex: "2024-06"
  if (!month) {
    return res.status(400).json({ error: 'Paramètre "month" requis (YYYY-MM)' });
  }

  const monthStart = `${month}-01`;
  const nextMonth = new Date(monthStart);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const monthEnd = nextMonth.toISOString().split('T')[0];

  try {
    // 1️⃣ Transactions internes (wallet)
    const transactionsResult = await pool.query(
      `SELECT * FROM transactions 
       WHERE user_id = $1 
         AND created_at >= $2
         AND created_at < $3
       ORDER BY created_at ASC`,
      [userId, monthStart, monthEnd]
    );
    const transactions = transactionsResult.rows;

    // 2️⃣ Cherche la carte Stripe du user
    const cardRes = await pool.query(
      `SELECT stripe_card_id FROM cards WHERE user_id = $1 AND status = 'active' LIMIT 1`,
      [userId]
    );
    let stripeIssuingTxs: any[] = [];
    if (cardRes.rows.length) {
      const stripeCardId = cardRes.rows[0].stripe_card_id;

      // 3️⃣ Appel Stripe: liste les transactions Stripe Issuing de la carte
      // Pagination Stripe = max 100 à la fois, ici on prend tout le mois
      const issuingTxs = await stripe.issuing.transactions.list({
        card: stripeCardId,
        created: {
          gte: Math.floor(new Date(monthStart).getTime() / 1000),
          lt: Math.floor(new Date(monthEnd).getTime() / 1000)
        },
        limit: 100
      });
      stripeIssuingTxs = issuingTxs.data;
    }

    // 4️⃣ PDF - commence après erreurs potentielles
    const doc = new PDFDocument();
    res.setHeader('Content-type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="statement-${month}.pdf"`);
    doc.pipe(res);

    doc.fontSize(18).text(`Relevé de Compte - ${month}`, { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Utilisateur: ${req.user?.username || userId}`);
    doc.moveDown();
    doc.text('Transactions internes Cash Hay :');
    doc.moveDown();

    transactions.forEach(tx => {
      doc.text(
        `${tx.created_at} | ${tx.type} | ${tx.amount} HTG | statut: ${tx.status} | ${tx.description || ''}`
      );
    });

    doc.moveDown();
    doc.text('Transactions Carte Stripe :');
    doc.moveDown();

    stripeIssuingTxs.forEach((tx: any) => {
      doc.text(
        `${new Date(tx.created * 1000).toISOString().slice(0, 10)} | ${tx.amount / 100} ${tx.currency.toUpperCase()} | ${tx.type} | ${tx.status} | ${tx.merchant_data?.name || ''}`
      );
    });

    // Total interne (tu peux ajouter le total Stripe si besoin)
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
    doc.moveDown();
    doc.fontSize(14).text(`Total net du mois (wallet): ${total} HTG`, { align: 'right' });

    doc.end();
  } catch (err) {
    console.error('❌ Erreur statement:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erreur serveur.' });
    } else {
      res.end();
    }
  }
};

export const cardPayment = async (
  req: Request & { user?: { id: string } },
  res: Response
) => {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Authentification requise' });
  }

  const userId = req.user.id;
  const { amount, merchant_id, card_id } = req.body;
  const ip_address =
    (req.headers['x-forwarded-for'] as string) ||
    req.socket.remoteAddress ||
    '';
  const user_agent = req.headers['user-agent'] || '';

  // Validation des entrées
  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Montant invalide' });
  }
  if (!merchant_id || !card_id) {
    return res.status(400).json({ error: 'Marchand et carte requis' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Vérification de la carte
    const cardCheck = await client.query<{
      id: string;
      stripe_card_id: string;
      is_locked: boolean;
      status: string;
    }>(
      `SELECT id, stripe_card_id, is_locked, status 
       FROM cards 
       WHERE user_id = $1 AND id = $2 FOR UPDATE`,
      [userId, card_id]
    );

    if (cardCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Carte non trouvée' });
    }

    const card = cardCheck.rows[0];
    if (card.is_locked || card.status !== 'active') {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Carte non disponible pour paiement' });
    }

    // 2. Vérification du solde utilisateur
    const balanceRes = await client.query<{ amount: number }>(
      `SELECT amount FROM balances WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    if (
      balanceRes.rows.length === 0 ||
      balanceRes.rows[0].amount < amount
    ) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Solde insuffisant' });
    }

    // 3. Génère un ID d'autorisation fictif, le vrai ID viendra du webhook Stripe
    const authId = `auth_${crypto.randomUUID()}`;

    // 4. Enregistre la transaction locale (statut "pending" en attendant le webhook Stripe)
    const txId = crypto.randomUUID();
    await client.query(
      `INSERT INTO transactions (
        id, user_id, type, amount, currency, status, source, 
        ip_address, user_agent, business_id, card_id, stripe_authorization_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        txId,
        userId,
        'card_payment',
        amount,
        'USD',
        'pending', // En attente d'autorisation Stripe
        'stripe_issuing',
        ip_address,
        user_agent,
        merchant_id,
        card_id,
        authId // Fictif pour l’instant, remplacé plus tard par le vrai ID Stripe
      ]
    );

    // 5. Déduit le solde localement
    await client.query(
      `UPDATE balances SET amount = amount - $1 
       WHERE user_id = $2`,
      [amount, userId]
    );

    // 6. Audit log
    await client.query(
      `INSERT INTO audit_logs 
       (user_id, action, ip_address, user_agent, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        userId,
        'card_payment',
        ip_address,
        user_agent,
        `Paiement de ${amount} USD chez marchand ${merchant_id}`,
      ]
    );

    await client.query('COMMIT');
    res.status(200).json({
      success: true,
      transaction_id: txId,
      stripe_authorization_id: authId, // Fictif pour l’instant
      amount: Number(amount),
      currency: 'USD'
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Erreur paiement:', err?.message || err);
    res.status(500).json({
      error: 'Erreur lors du traitement du paiement',
      details: err?.message || 'Veuillez réessayer plus tard',
    });
  } finally {
    client.release();
  }
};