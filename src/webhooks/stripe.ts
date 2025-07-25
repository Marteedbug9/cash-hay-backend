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
      req.body, // <--- Doit être le RAW body, pas JSON-parsé !
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
      case 'issuing_authorization.request': {
        const auth = event.data.object as Stripe.Issuing.Authorization;
        // Tu peux ici loguer ou enregistrer l'autorisation reçue, par exemple :
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
            auth.approved ? 'approved' : 'pending',
            auth.merchant_data?.name || null,
          ]
        );
        // Tu peux ici notifier l'utilisateur, ou mettre à jour la transaction locale, etc.
        break;
      }

      case 'issuing_authorization.updated': {
        const auth = event.data.object as Stripe.Issuing.Authorization;
        // Update de statut (ex : approved/refused)
        await client.query(
          `UPDATE stripe_authorizations 
           SET status = $1, updated_at = NOW()
           WHERE id = $2`,
          [
            auth.approved ? 'approved' : (auth.pending_request ? 'pending' : 'declined'),
            auth.id
          ]
        );
        // Tu peux lier ici à ta table transactions si besoin
        break;
      }

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