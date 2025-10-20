// src/controllers/transactionController.ts
import { Request, Response } from 'express';
import pool from '../config/db';
import { v4 as uuidv4 } from 'uuid';
import PDFDocument from 'pdfkit';
import { sendPushNotification,notifyUser, sendEmail, sendSMS } from '../utils/notificationUtils';
import { addNotification } from './notificationsController'; 
import stripe from '../config/stripe';
import { receiveFromCustomerBank } from '../utils/bankingUtils';
import {
  decryptNullable,
  encrypt,
  blindIndexEmail,
  blindIndexPhone,
} from '../utils/crypto';
import crypto from 'crypto';

import { deliverEmailWithLogo } from '../templates/emails/_deliver';
import { buildMoneyReceivedEmail } from '../templates/emails/moneyReceivedEmail';
import { buildMoneySentEmail } from '../templates/emails/moneySentEmail';
import { buildDepositEmail } from '../templates/emails/depositEmail';
import { buildWithdrawalEmail } from '../templates/emails/withdrawalEmail';
import { buildMoneyRequestEmail } from '../templates/emails/MoneyRequestEmail';


// Fonction pour envoyer vers ta banque locale (ex: via API REST interne, à adapter)
async function sendToLocalBankBusiness(accountInfo: any, amount: number) {
  // Ici tu appelles l’API de ta banque ou effectues le virement
  // Return { success: boolean, message?: string }
  // Simulé :
  return { success: true };
}
// En haut du fichier
const WITHDRAWAL_MCCS = ['4829', '6011']; // Money Transfer, ATM


export const getTransactions = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  try {
    const result = await pool.query(
      `
      SELECT 
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
        -- on garde les champs chiffrés si on veut les utiliser en code :
        t.recipient_email_enc,
        t.recipient_phone_enc,
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
      ORDER BY t.created_at DESC
      `,
      [userId]
    );

    // Optionnel : exposer un contact “lisible” côté API (décrypté)
    const transactions = result.rows.map(r => ({
      ...r,
      recipient_email: decryptNullable(r.recipient_email_enc) || null,
      recipient_phone: decryptNullable(r.recipient_phone_enc) || null,
    }));

    res.json({ transactions });
  } catch (err) {
    console.error('❌ Erreur transactions:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};



export const createTransaction = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const {
    type, amount, currency = 'HTG', description, recipient_id, source = 'manual', business_id
  } = req.body;

  const ip_address = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
  const user_agent = req.headers['user-agent'] || '';

  if (!type || !amount || isNaN(amount)) {
    return res.status(400).json({ error: 'Type et montant requis.' });
  }

  try {
    let recipientEmailEnc: string | null = null;
    let recipientEmailBidx: string | null = null;
    let recipientPhoneEnc: string | null = null;
    let recipientPhoneBidx: string | null = null;

    if (type === 'transfer') {
      if (!recipient_id) {
        return res.status(400).json({ error: 'recipient_id requis pour un transfert.' });
      }
      const r = await pool.query(
        `SELECT id, email_enc, email_bidx, phone_enc, phone_bidx FROM users WHERE id = $1`,
        [recipient_id]
      );
      if (!r.rowCount) return res.status(404).json({ error: 'Bénéficiaire introuvable.' });
      const rec = r.rows[0];
      recipientEmailEnc  = rec.email_enc ?? null;
      recipientEmailBidx = rec.email_bidx ?? null;
      recipientPhoneEnc  = rec.phone_enc ?? null;
      recipientPhoneBidx = rec.phone_bidx ?? null;
    }

    await pool.query(
      `INSERT INTO transactions (
        id, user_id, type, amount, currency, recipient_id, source, description,
        ip_address, user_agent, business_id, status,
        recipient_email_enc, recipient_email_bidx, recipient_phone_enc, recipient_phone_bidx,
        created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, 'completed',
        $12, $13, $14, $15,
        NOW()
      )`,
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
        business_id || null,
        recipientEmailEnc,
        recipientEmailBidx,
        recipientPhoneEnc,
        recipientPhoneBidx,
      ]
    );

    // … logique de soldes inchangée …

    // ✅ Email destinataire : lire email_enc et le décrypter !
    if (type === 'transfer' && recipient_id) {
      try {
        const destRes = await pool.query('SELECT email_enc FROM users WHERE id = $1', [recipient_id]);
        const email = decryptNullable(destRes.rows[0]?.email_enc);
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
  if (!userId) {
    return res.status(401).json({ error: "Utilisateur non authentifié." });
  }

  const { amount, source = 'bank', currency = 'HTG', bank } = req.body;
  const ip_address =
    (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
  const user_agent = req.headers['user-agent'] || '';

  if (!amount || isNaN(amount) || amount <= 0 || !bank) {
    return res.status(400).json({ error: 'Montant ou banque invalide.' });
  }

  // petit helper d’affichage
  const formatHTG = (n: number) =>
    `${Number(n).toLocaleString('fr-HT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} HTG`;

  const client = await pool.connect();
  let txId = uuidv4();

  try {
    await client.query('BEGIN');

    // 1️⃣ Déclenche le virement bancaire du client → vers business local
    const transferResult = await receiveFromCustomerBank(bank, amount, userId);
    if (!transferResult.success) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({ error: 'Échec du virement depuis la banque du client.' });
    }

    // 2️⃣ Créditer le wallet interne de l'utilisateur
    await client.query(
      `UPDATE balances SET amount = amount + $1, updated_at = NOW() WHERE user_id = $2`,
      [amount, userId]
    );

    // ID de transaction (on utilise la valeur générée plus haut)
    await client.query(
      `INSERT INTO transactions (
         id, user_id, type, amount, currency, source, status, ip_address, user_agent, created_at
       ) VALUES (
         $1, $2, 'deposit', $3, $4, $5, 'completed', $6, $7, NOW()
       )`,
      [txId, userId, amount, currency, source, ip_address, user_agent]
    );

    // 3️⃣ Audit log
    await client.query(
      `INSERT INTO audit_logs (id, user_id, action, ip_address, user_agent, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uuidv4(), userId, 'deposit', ip_address, user_agent, `Dépôt de ${amount} ${currency} depuis ${bank.bank}`]
    );

    await client.query('COMMIT');
    client.release();

    // 4️⃣ Notification email (async, avec template HTML)
    (async () => {
      try {
        // Récup infos user + solde après crédit
        const [userRes, balRes] = await Promise.all([
          pool.query(`SELECT first_name, first_name_enc, email_enc FROM users WHERE id = $1`, [userId]),
          pool.query(`SELECT amount FROM balances WHERE user_id = $1`, [userId]),
        ]);

        const row = userRes.rows[0] || {};
        const firstName =
  ((row.first_name as string | null) ?? decryptNullable(row.first_name_enc)) ?? '';

        const email = decryptNullable(row.email_enc);

        const balanceAfter = Number(balRes.rows[0]?.amount || 0);

        if (email) {
          const { subject, text, html } = buildDepositEmail({
            firstName,
            amountLabel: formatHTG(Number(amount)),
            balanceAfterLabel: formatHTG(balanceAfter),
            txRef: txId.split('-')[0].toUpperCase(), // petite réf lisible
            loginUrl: process.env.APP_LOGIN_URL || 'https://app.cash-hay.com/login',
          });

          // si le typage de sendEmail n'inclut pas html, on caste en any pour éviter une erreur TS
          await (sendEmail as any)({
            to: email,
            subject,
            text,
            html,
          });
        }
      } catch (notifErr) {
        console.error('Erreur notif dépôt (email):', notifErr);
      }
    })();

    return res.status(200).json({ message: 'Dépôt effectué avec succès.', amount });
  } catch (error: any) {
    await client.query('ROLLBACK');
    client.release();
    console.error('❌ Erreur dépôt :', error.message);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};



export const withdraw = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const rawAmount = (req.body?.amount ?? '').toString();
  const bank = req.body?.bank;

  const amt = Number(rawAmount);

  if (!userId) {
    return res.status(401).json({ error: 'Authentification requise.' });
  }
  if (!rawAmount || isNaN(amt) || amt <= 0 || !bank) {
    return res.status(400).json({ error: 'Montant ou banque invalide.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1️⃣ Solde utilisateur (lock)
    const balanceRes = await client.query(
      'SELECT amount FROM balances WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
    const currentBalance = parseFloat(balanceRes.rows[0]?.amount || '0');

    if (currentBalance < amt) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Solde insuffisant.' });
    }

    // 2️⃣ Vérif carte Stripe si demandé
    if (bank?.type === 'card') {
      let stripeCardId: string | null = bank.stripe_card_id || null;

      if (!stripeCardId) {
        const cardRes = await client.query(
          'SELECT stripe_card_id FROM cards WHERE id = $1 AND user_id = $2 AND status = $3 LIMIT 1',
          [bank.id, userId, 'active']
        );
        stripeCardId = cardRes.rows[0]?.stripe_card_id ?? null;
        if (!stripeCardId) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Carte Stripe non trouvée.' });
        }
      }

      const card = await stripe.issuing.cards.retrieve(stripeCardId);
      if (card.status !== 'active') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Carte Stripe non active.' });
      }

      const blocked = card.spending_controls?.blocked_categories ?? [];
      if (blocked.some((mcc: string) => WITHDRAWAL_MCCS.includes(mcc))) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Carte bloquée pour retrait ou transfert.' });
      }

      // (optionnel) Plafonds, etc.
    }

    // 3️⃣ Débit du wallet interne
    await client.query(
      'UPDATE balances SET amount = amount - $1 WHERE user_id = $2',
      [amt, userId]
    );
    const balanceAfter = currentBalance - amt;

    // 4️⃣ Virement vers la banque locale (adapter votre service)
    const localBusinessAccount = { ...bank };
    const result = await sendToLocalBankBusiness(localBusinessAccount, amt);
    if (!result?.success) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'Transfert vers la banque locale échoué.' });
    }

    // 5️⃣ Log transaction
    await client.query(
      `INSERT INTO transactions
         (id, user_id, type, amount, currency, status, recipient_id, description, created_at)
       VALUES (gen_random_uuid(), $1, 'withdraw', $2, 'HTG', 'pending', NULL, 'Retrait banque', NOW())`,
      [userId, amt]
    );

    await client.query('COMMIT');

    // 6️⃣ Email (asynchrone, après COMMIT) via deliverEmailWithLogo
    (async () => {
      try {
        const amountLabel = `${amt.toFixed(2)} HTG`;
        const balanceAfterLabel = `${balanceAfter.toFixed(2)} HTG`;

        const built = buildWithdrawalEmail({
          firstName: '', // si vous voulez afficher le prénom, récupérez-le si nécessaire
          amountLabel,
          balanceAfterLabel,
          loginUrl: process.env.APP_LOGIN_URL || 'https://app.cash-hay.com/login',
        });

        await deliverEmailWithLogo(
          { toUserId: userId }, // ✅ pas d’email en clair
          built,
          { priority: 'normal' }
        );
      } catch (e) {
        console.error('Erreur envoi email retrait:', e);
      }
    })();

    return res.json({ message: 'Retrait en cours de traitement. Vous serez notifié.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur retrait:', err);
    return res.status(500).json({ error: 'Erreur lors du retrait.' });
  } finally {
    client.release();
  }
};


export const transfer = async (req: Request, res: Response) => {
  const senderId = req.user?.id;
  const { recipientUsername, amount } = req.body as { recipientUsername: string; amount: number };
  const transferFee = 0.57;

  const ip_address =
    (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
  const user_agent = (req.headers['user-agent'] as string) || '';

  if (!senderId) {
    return res.status(401).json({ error: 'Authentification requise.' });
  }
  if (!recipientUsername || !amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Données invalides.' });
  }

  const amt = Number(amount);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 🔎 Trouver le membre destinataire (email/téléphone en clair dans members.contact)
    const cleanedContact = recipientUsername.trim().toLowerCase();
    let memberRes;
    if (cleanedContact.includes('@')) {
      memberRes = await client.query('SELECT id FROM members WHERE LOWER(contact) = $1', [cleanedContact]);
    } else {
      const digits = cleanedContact.replace(/\D/g, '');
      memberRes = await client.query(
        `SELECT id FROM members
           WHERE REPLACE(REPLACE(REPLACE(contact, '+', ''), ' ', ''), '-', '') = $1
              OR RIGHT(REPLACE(REPLACE(REPLACE(contact, '+', ''), ' ', ''), '-', ''), 8) = $2`,
        [digits, digits.slice(-8)]
      );
    }
    if (!memberRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Destinataire introuvable ou non inscrit.' });
    }
    const memberId: string = memberRes.rows[0].id;

    // 👤 Récupérer l’utilisateur destinataire
    const recipientUserRes = await client.query(
      `SELECT id, first_name, last_name, email_enc, phone_enc, expo_push_token
         FROM users
        WHERE member_id = $1
        LIMIT 1`,
      [memberId]
    );
    if (!recipientUserRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Aucun utilisateur lié à ce membre.' });
    }
    const recipientUser = recipientUserRes.rows[0] as {
      id: string;
      first_name: string | null;
      last_name: string | null;
      email_enc: string | null;
      phone_enc: string | null;
      expo_push_token?: string | null;
    };
    const recipientId = recipientUser.id;

    // 🚫 Auto-transfert interdit
    if (recipientId === senderId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Impossible de vous envoyer de l’argent à vous-même.' });
    }

    // 💳 (Optionnel) carte Stripe active (audit)
    await client.query(
      'SELECT stripe_card_id FROM cards WHERE user_id = $1 AND status = $2 LIMIT 1',
      [senderId, 'active']
    );

    // 💰 Vérifie solde + frais
    const senderBalanceRes = await client.query(
      'SELECT amount FROM balances WHERE user_id = $1 FOR UPDATE',
      [senderId]
    );
    const senderBalance = parseFloat(senderBalanceRes.rows[0]?.amount || '0');
    if (senderBalance < amt + transferFee) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Fonds insuffisants (incluant les frais).' });
    }

    // 🔀 Mouvements wallets
    await client.query('UPDATE balances SET amount = amount - $1 WHERE user_id = $2', [amt + transferFee, senderId]);
    await client.query('UPDATE balances SET amount = amount + $1 WHERE user_id = $2', [amt, recipientId]);

    // 🔐 Préparer champs destinataire chiffrés pour la transaction
    const recipientEmailPlain = decryptNullable(recipientUser.email_enc);
    const recipientPhonePlain = decryptNullable(recipientUser.phone_enc);

    const recipient_email_enc  = recipientEmailPlain ? encrypt(recipientEmailPlain) : null;
    const recipient_email_bidx = recipientEmailPlain ? blindIndexEmail(recipientEmailPlain) : null;
    const recipient_phone_enc  = recipientPhonePlain ? encrypt(recipientPhonePlain) : null;
    const recipient_phone_bidx = recipientPhonePlain ? blindIndexPhone(recipientPhonePlain) : null;

    // 🧾 Transaction principale
    const txId = uuidv4();
    await client.query(
      `INSERT INTO transactions (
         id, user_id, type, amount, currency,
         recipient_id, member_id, source, status,
         ip_address, user_agent,
         recipient_email_enc, recipient_email_bidx,
         recipient_phone_enc, recipient_phone_bidx,
         created_at
       ) VALUES (
         $1, $2, 'transfer', $3, 'HTG',
         $4, $5, 'stripe_issuing', 'waiting_stripe',
         $6, $7,
         $8, $9,
         $10, $11,
         NOW()
       )`,
      [
        txId,
        senderId,
        amt,
        recipientId,
        memberId,
        ip_address,
        user_agent,
        recipient_email_enc,
        recipient_email_bidx,
        recipient_phone_enc,
        recipient_phone_bidx,
      ]
    );

    // 🧾 Audit
    await client.query(
      `INSERT INTO audit_logs (id, user_id, action, ip_address, user_agent, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uuidv4(), senderId, 'transfer', ip_address, user_agent, `Transfert de ${amt} HTG à ${recipientId}`]
    );

    // 🧾 Frais admin
    const adminId = process.env.ADMIN_USER_ID || 'admin-id-123';
    await client.query('UPDATE balances SET amount = amount + $1 WHERE user_id = $2', [transferFee, adminId]);
    await client.query(
      `INSERT INTO transactions (
         id, user_id, type, amount, currency, recipient_id, source, status, description, ip_address, user_agent, created_at
       )
       VALUES ($1, $2, 'fee', $3, 'HTG', $4, 'fee', 'completed', 'Frais de transfert', $5, $6, NOW())`,
      [uuidv4(), senderId, transferFee, adminId, ip_address, user_agent]
    );

    await client.query('COMMIT');

    // ========= Notifications =========

    // Infos expéditeur/destinataire (pour templates + push/SMS)
    const senderRes = await pool.query(
      `SELECT first_name, email_enc, phone_enc, expo_push_token FROM users WHERE id = $1`,
      [senderId]
    );
    const senderRow = senderRes.rows[0] || {};
    const senderFirst = (senderRow.first_name ?? '') as string;
    const recipientFirst = (recipientUser.first_name ?? '') as string;

    const rEmail = decryptNullable(recipientUser.email_enc) ?? undefined;
    const rPhone = decryptNullable(recipientUser.phone_enc) ?? undefined;
    const rPush  = recipientUser.expo_push_token ?? undefined;

    const sEmail = decryptNullable(senderRow.email_enc) ?? undefined;
    const sPhone = decryptNullable(senderRow.phone_enc) ?? undefined;
    const sPush  = senderRow.expo_push_token ?? undefined;

    // Push/SMS
    const recipientPayload = {
      title: 'Transfert reçu',
      subject: 'Transfert reçu - Cash Hay',
      body: `Bonjour${recipientFirst ? ' ' + recipientFirst : ''}, vous avez reçu ${amt} HTG via Cash Hay.`,
      sms:  `Vous avez reçu ${amt} HTG via Cash Hay.`,
      expoPushToken: rPush,
      email: rEmail,
      phone: rPhone,
    };
    const senderPayload = {
      title: 'Transfert envoyé',
      subject: 'Transfert envoyé - Cash Hay',
      body: `Bonjour${senderFirst ? ' ' + senderFirst : ''}, votre transfert de ${amt} HTG a été envoyé.`,
      sms:  `Votre transfert de ${amt} HTG a été envoyé.`,
      expoPushToken: sPush,
      email: sEmail,
      phone: sPhone,
    };
    try { await notifyUser(recipientPayload); } catch (e) { console.error('notifyUser destinataire:', e); }
    try { await notifyUser(senderPayload);    } catch (e) { console.error('notifyUser expéditeur:', e); }

    // ========= Emails HTML (avec logo inline) =========
    const amountLabel = `${amt.toFixed(2)} HTG`;
    const createdAtLabel = new Date().toLocaleString('fr-FR');

    // Destinataire : moneyReceivedEmail
    try {
      const builtR = buildMoneyReceivedEmail({
        recipientFirstName: recipientFirst,
        senderFirstName: senderFirst,
        amountLabel,
        txRef: txId,
        createdAtLabel,
      });
      await deliverEmailWithLogo(
        { toUserId: recipientId },
        builtR,
        { priority: 'normal' }
      );
    } catch (e) {
      console.error('Email destinataire (received) échoué:', e);
    }

    // Expéditeur : moneySentEmail
    try {
      const builtS = buildMoneySentEmail({
        senderFirstName: senderFirst,
        recipientFirstName: recipientFirst,
        amountLabel,
        txRef: txId,
        createdAtLabel,
      });
      await deliverEmailWithLogo(
        { toUserId: senderId },
        builtS,
        { priority: 'normal' }
      );
    } catch (e) {
      console.error('Email expéditeur (sent) échoué:', e);
    }

    return res.status(200).json({ message: 'Transfert effectué avec succès.', tx_id: txId });
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
  const { recipientUsername, amount } = req.body as { recipientUsername: string; amount: number };

  const ip_address =
    (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
  const user_agent = (req.headers['user-agent'] as string) || '';

  if (!requesterId) return res.status(401).json({ error: 'Authentification requise.' });
  if (!recipientUsername || !amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Données invalides.' });
  }

  const amt = Number(amount);
  const cleanedContact = recipientUsername.trim().toLowerCase();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Trouver le membre destinataire via members.contact (email/tel en clair)
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
           WHERE REPLACE(REPLACE(REPLACE(contact, '+', ''), ' ', ''), '-', '') = $1
              OR RIGHT(REPLACE(REPLACE(REPLACE(contact, '+', ''), ' ', ''), '-', ''), 8) = $2`,
        [digits, digits.slice(-8)]
      );
    }
    if (!memberRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Destinataire introuvable ou non inscrit.' });
    }
    const memberId: string = memberRes.rows[0].id;

    // 2) Récupérer l’utilisateur destinataire lié à ce membre
    const recipientUserRes = await client.query(
      `SELECT id, first_name, last_name, email_enc, phone_enc, photo_url
         FROM users
        WHERE member_id = $1
        LIMIT 1`,
      [memberId]
    );
    if (!recipientUserRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Aucun utilisateur lié à ce membre.' });
    }
    const recipient = recipientUserRes.rows[0] as {
      id: string;
      first_name: string | null;
      last_name: string | null;
      email_enc: string | null;
      phone_enc: string | null;
      photo_url: string | null;
    };
    const recipientId = recipient.id;

    // 2bis) Empêcher auto-demande
    if (recipientId === requesterId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Impossible de vous faire une demande à vous-même.' });
    }

    // 3) Préparer les champs destinataire chiffrés/BI pour transactions
    const recEmailPlain = decryptNullable(recipient.email_enc) || null;
    const recPhonePlain = decryptNullable(recipient.phone_enc) || null;

    const recipient_email_enc  = recEmailPlain ? encrypt(recEmailPlain) : null;
    const recipient_email_bidx = recEmailPlain ? blindIndexEmail(recEmailPlain) : null;
    const recipient_phone_enc  = recPhonePlain ? encrypt(recPhonePlain) : null;
    const recipient_phone_bidx = recPhonePlain ? blindIndexPhone(recPhonePlain) : null;

    // 4) Créer la transaction pending
    const txId = uuidv4();
    await client.query(
      `INSERT INTO transactions (
         id, user_id, type, amount, currency,
         recipient_id, member_id, source, status,
         ip_address, user_agent,
         recipient_email_enc, recipient_email_bidx,
         recipient_phone_enc, recipient_phone_bidx,
         created_at
       )
       VALUES (
         $1, $2, 'request', $3, 'HTG',
         $4, $5, 'app', 'pending',
         $6, $7,
         $8, $9,
         $10, $11,
         NOW()
       )`,
      [
        txId,
        requesterId,
        amt,
        recipientId,
        memberId,
        ip_address,
        user_agent,
        recipient_email_enc,
        recipient_email_bidx,
        recipient_phone_enc,
        recipient_phone_bidx,
      ]
    );

    // 5) Audit
    await client.query(
      `INSERT INTO audit_logs (id, user_id, action, ip_address, user_agent, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uuidv4(), requesterId, 'request_money', ip_address, user_agent, `Demande ${amt} HTG à user:${recipientId}`]
    );

    // 6) Infos expéditeur (incluant son members.contact)
    const senderRes = await client.query(
      `SELECT u.first_name, u.last_name, u.photo_url, COALESCE(m.contact,'') AS member_contact
         FROM users u
         LEFT JOIN members m ON m.user_id = u.id
        WHERE u.id = $1
        LIMIT 1`,
      [requesterId]
    );
    const sender = senderRes.rows[0] || {};
    const requesterFirst = (sender.first_name || '') as string;
    const requesterLabel = ((sender.member_contact || '') as string).trim(); // email/tel affichable

    // 7) Notif BDD
    await addNotification({
      user_id: recipientId, // le destinataire reçoit la notif
      type: 'request',
      from_first_name: sender.first_name || '',
      from_last_name:  sender.last_name  || '',
      from_contact: requesterLabel,
      from_profile_image: sender.photo_url || '',
      amount: amt,
      status: 'pending',
      transaction_id: txId,
    });

    // 8) Push (si la colonne existe)
    let expoPushToken: string | null = null;
    const { rows: hasCol } = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='users' AND column_name='expo_push_token'
      ) AS has_col;
    `);
    if (hasCol[0]?.has_col) {
      const tok = await client.query('SELECT expo_push_token FROM users WHERE id = $1', [recipientId]);
      expoPushToken = tok.rows[0]?.expo_push_token ?? null;
    }

    await client.query('COMMIT');

    // 9) Emails + Push (asynchrone, hors transaction)
    (async () => {
      try {
        const amountLabel = `${amt.toFixed(2)} HTG`;
        const createdAtLabel = new Date().toLocaleString('fr-FR');
        const recipientFirstName = (recipient.first_name || '') as string;

        // 🔎 Emails chiffrés (filet de sécurité pour resolveEmail)
        const [recRow, reqRow] = await Promise.all([
          pool.query(`SELECT email_enc FROM users WHERE id = $1 LIMIT 1`, [recipientId]),
          pool.query(`SELECT email_enc FROM users WHERE id = $1 LIMIT 1`, [requesterId]),
        ]);
        const recipientEmailEnc = recRow.rows[0]?.email_enc ?? null;
        const requesterEmailEnc = reqRow.rows[0]?.email_enc ?? null;

        // a) Email DESTINATAIRE : variante "received"
        if (recipientEmailEnc) {
          const builtForRecipient = buildMoneyRequestEmail({
            variant: 'received',
            requesterFirstName: requesterFirst,
            requesterLabel: requesterLabel,
            amountLabel,
            requestRef: txId,
            createdAtLabel,
          });
          await deliverEmailWithLogo(
            { toUserId: recipientId, toEmailEnc: recipientEmailEnc },
            builtForRecipient,
            { priority: 'normal' }
          );
        } else {
          console.warn(`requestMoney: email destinataire introuvable (user_id=${recipientId}) -> skip email`);
        }

        // b) Email ÉMETTEUR : variante "sent"
        if (requesterEmailEnc) {
          const builtForRequester = buildMoneyRequestEmail({
            variant: 'sent',
            recipientFirstName,
            amountLabel,
            requestRef: txId,
            createdAtLabel,
          });
          await deliverEmailWithLogo(
            { toUserId: requesterId!, toEmailEnc: requesterEmailEnc },
            builtForRequester,
            { priority: 'normal' }
          );
        } else {
          console.warn(`requestMoney: email émetteur introuvable (user_id=${requesterId}) -> skip email`);
        }

        // c) Push (si disponible)
        if (expoPushToken) {
          await sendPushNotification(
            expoPushToken,
            'Demande d’argent',
            `Vous avez reçu une demande de ${amountLabel}.`
          );
        }
      } catch (e) {
        console.error('Notif async requestMoney:', e);
      }
    })();

    return res.status(200).json({ message: 'Demande d’argent enregistrée avec succès.', tx_id: txId });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('❌ Erreur requestMoney :', error);
    return res.status(500).json({ error: 'Erreur serveur lors de la demande.' });
  } finally {
    client.release();
  }
};




export const acceptRequest = async (req: Request, res: Response) => {
  const userId = req.user?.id;       // payeur (celui qui accepte et paie)
  const { id } = req.params;         // notification id

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1️⃣ Récupérer la notification (pending)
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

    // 2️⃣ Transaction concernée (pending)
    const txRes = await client.query(
      `SELECT * FROM transactions WHERE id = $1 AND status = 'pending'`,
      [transaction_id]
    );
    const transaction = txRes.rows[0];
    if (!transaction) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Transaction introuvable ou déjà traitée.' });
    }

    // 3️⃣ Vérifier solde du payeur (userId)
    const balanceRes = await client.query(
      `SELECT amount FROM balances WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    const currentBalance = parseFloat(balanceRes.rows[0]?.amount || '0');
    const fee = 0.57;
    const amtNum = parseFloat(amount);
    const totalToDeduct = amtNum + fee;
    if (currentBalance < totalToDeduct) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Solde insuffisant. Vous avez ${currentBalance} HTG mais ${totalToDeduct} HTG est requis.`,
      });
    }

    // 4️⃣ (Optionnel) Carte Stripe active (payeur)
    const cardRes = await client.query(
      'SELECT stripe_card_id FROM cards WHERE user_id = $1 AND status = $2 LIMIT 1',
      [userId, 'active']
    );
    if (!cardRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Aucune carte Stripe active trouvée.' });
    }
    // const stripeCardId = cardRes.rows[0].stripe_card_id; // non utilisé si on n’appelle pas Stripe ici

    // 5️⃣ Placer en waiting_stripe
    await client.query(`UPDATE notifications SET status = 'waiting_stripe', updated_at = NOW() WHERE id = $1`, [id]);
    await client.query(
      `UPDATE transactions SET status = 'waiting_stripe', stripe_authorization_id = NULL WHERE id = $1`,
      [transaction_id]
    );

    await client.query('COMMIT');

    // ========= Notifications (méthode A) =========
    // Payer (userId) & Demandeur (transaction.user_id)
    const payerRes = await pool.query(
      `SELECT first_name, email_enc, phone_enc, expo_push_token FROM users WHERE id = $1`,
      [userId]
    );
    const requesterRes = await pool.query(
      `SELECT first_name, email_enc, phone_enc, expo_push_token FROM users WHERE id = $1`,
      [transaction.user_id]
    );

    const payer = payerRes.rows[0] || {};
    const requester = requesterRes.rows[0] || {};

    const payerFirst = (payer.first_name ?? '') as string;
    const requesterFirst = (requester.first_name ?? '') as string;

    // Email/Phone/Push sûrs
    const payerEmail = decryptNullable(payer.email_enc) ?? undefined;
    const payerPhone = decryptNullable(payer.phone_enc) ?? undefined;
    const payerPush  = payer.expo_push_token ?? undefined;

    const requesterEmail = decryptNullable(requester.email_enc) ?? undefined;
    const requesterPhone = decryptNullable(requester.phone_enc) ?? undefined;
    const requesterPush  = requester.expo_push_token ?? undefined;

    // Payload payer (confirmation d’acceptation en cours)
    const payerPayload: {
      title: string;
      body: string;
      subject: string;
      sms?: string;
      expoPushToken?: string;
      email?: string;
      phone?: string;
    } = {
      title: 'Demande acceptée',
      subject: 'Votre paiement est en cours (Cash Hay)',
      body: `Bonjour${payerFirst ? ' ' + payerFirst : ''}, votre paiement de ${amtNum} HTG est en cours de traitement.`,
      sms:  `Votre paiement de ${amtNum} HTG est en cours.`,
    };
    if (payerPush)  payerPayload.expoPushToken = payerPush;
    if (payerEmail) payerPayload.email = payerEmail;
    if (payerPhone) payerPayload.phone = payerPhone;

    // Payload demandeur (info : acceptée, en cours)
    const requesterPayload: {
      title: string;
      body: string;
      subject: string;
      sms?: string;
      expoPushToken?: string;
      email?: string;
      phone?: string;
    } = {
      title: 'Demande acceptée',
      subject: 'Demande acceptée – en cours (Cash Hay)',
      body: `Bonjour${requesterFirst ? ' ' + requesterFirst : ''}, votre demande de ${amtNum} HTG a été acceptée. Crédits en cours.`,
      sms:  `Votre demande de ${amtNum} HTG a été acceptée.`,
    };
    if (requesterPush)  requesterPayload.expoPushToken = requesterPush;
    if (requesterEmail) requesterPayload.email = requesterEmail;
    if (requesterPhone) requesterPayload.phone = requesterPhone;

    try { await notifyUser(payerPayload);     } catch (e) { console.error('notifyUser payer:', e); }
    try { await notifyUser(requesterPayload); } catch (e) { console.error('notifyUser requester:', e); }

    // ✉️ Emails HTML optionnels (mêmes templates que transfert, libellés "en cours")
    const amountLabel = `${amtNum.toFixed(2)} HTG`;

    if (requesterEmail) {
      const tplR = buildMoneyReceivedEmail({
        recipientFirstName: requesterFirst,
        senderFirstName: payerFirst,
        amountLabel,
      });
      await sendEmail({
        to: requesterEmail,
        subject: 'Demande acceptée – en cours de traitement (Cash Hay)',
        text: tplR.text,
        html: tplR.html,
      });
    }
    if (payerEmail) {
      const tplS = buildMoneySentEmail({
        senderFirstName: payerFirst,
        recipientFirstName: requesterFirst,
        amountLabel,
      });
      await sendEmail({
        to: payerEmail,
        subject: 'Votre paiement est en cours (Cash Hay)',
        text: tplS.text,
        html: tplS.html,
      });
    }

    return res.json({
      message: 'Paiement en cours de traitement. Le bénéficiaire sera crédité dès validation Stripe.',
      stripe_authorization_id: null
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur acceptRequest :', err);
    return res.status(500).json({ error: 'Erreur lors de l’acceptation de la demande.' });
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