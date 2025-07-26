import { Request, Response } from 'express';
import stripe from '../config/stripe';
import pool from '../config/db';
import Stripe from 'stripe';

export const handleStripeWebhook = async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string | undefined;
  if (!sig) {
    return res.status(400).json({ error: 'Missing stripe signature header' });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body, // Attention : req.body doit être le RAW body !
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error('Unknown error');
    return res.status(400).json({ error: `Webhook Error: ${error.message}` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    switch (event.type) {
      // 1️⃣ Premier passage, log de l'intention (peut être optionnel)
      case 'issuing_authorization.request': {
        const auth = event.data.object as Stripe.Issuing.Authorization;
        await client.query(
          `INSERT INTO stripe_authorizations 
            (id, card_id, amount, currency, status, merchant_name, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (id) DO UPDATE SET
            status = $5, amount = $3, currency = $4, merchant_name = $6, updated_at = NOW()`,
          [
            auth.id,
            auth.card?.id,
            auth.amount,
            auth.currency,
            auth.approved ? 'approved' : (auth.pending_request ? 'pending' : 'declined'),
            auth.merchant_data?.name || null,
          ]
        );
        break;
      }

      // 2️⃣ Autorisation Stripe mise à jour (statut)
      case 'issuing_authorization.updated': {
        const auth = event.data.object as Stripe.Issuing.Authorization;

        // Met à jour le statut Stripe
        await client.query(
          `UPDATE stripe_authorizations 
           SET status = $1, updated_at = NOW()
           WHERE id = $2`,
          [
            auth.approved ? 'approved' : (auth.pending_request ? 'pending' : 'declined'),
            auth.id
          ]
        );

        // Si approuvé, crédite le bénéficiaire et complète la transaction
        if (auth.approved) {
          // Récupère la transaction liée à cette authorization Stripe (mapping sur ta colonne stripe_authorization_id)
          const txRes = await client.query(
            `SELECT * FROM transactions WHERE stripe_authorization_id = $1 AND status = 'waiting_stripe'`,
            [auth.id]
          );
          const tx = txRes.rows[0];
          if (tx) {
            // Créditer le bénéficiaire
            await client.query(
              `UPDATE balances SET amount = amount + $1 WHERE user_id = $2`,
              [tx.amount, tx.recipient_id]
            );
            await client.query(
              `UPDATE transactions SET status = 'completed', updated_at = NOW() WHERE id = $1`,
              [tx.id]
            );
            // Optionnel : notifier le bénéficiaire (mail/push/SMS)
            // notifyUser(...)
          }
        }
        break;
      }

      // 3️⃣ Carte Stripe modifiée
      case 'issuing_card.updated': {
        const card = event.data.object as Stripe.Issuing.Card;
        await client.query(
          `UPDATE cards SET 
            status = $1, 
            is_locked = $2,
            updated_at = NOW()
           WHERE stripe_card_id = $3`,
          [card.status, card.status !== 'active', card.id]
        );
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    await client.query('COMMIT');
    res.json({ received: true });
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    const error = err instanceof Error ? err : new Error('Unknown error');
    console.error('Erreur webhook:', error);
    res.status(500).json({
      error: 'Erreur de traitement',
      details: error.message
    });
  } finally {
    client.release();
  }
};
