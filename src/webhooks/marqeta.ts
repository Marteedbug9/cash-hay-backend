import { Request, Response } from 'express';
import pool from '../config/db';

export const handleMarqetaWebhook = async (req: Request, res: Response) => {
  const event = req.body;

  console.log('📩 Marqeta Webhook reçu:', JSON.stringify(event, null, 2));

  try {
    switch (event.type) {
      case 'card':
        const cardData = event.card;
        if (cardData && cardData.token) {
          await pool.query(
            `UPDATE cards SET status = $1, updated_at = NOW() WHERE legacy_card_number = $2`,
            [cardData.state, cardData.token]
          );
          console.log(`✅ Carte mise à jour: ${cardData.token} → ${cardData.state}`);
        }
        break;

      case 'transaction':
        const tx = event.transaction;
        if (tx && tx.user_token) {
          const userIdMatch = tx.user_token.match(/^user_(.+)$/);
          if (userIdMatch) {
            const userId = userIdMatch[1];

            await pool.query(
              `INSERT INTO transactions (user_id, card_id, amount, currency, status, type, description, source, created_at)
               VALUES ($1, NULL, $2, $3, $4, $5, $6, 'marqeta', NOW())`,
              [
                userId,
                tx.amount,
                tx.currency || 'USD',
                tx.state,
                tx.type || 'purchase',
                tx.merchant_descriptor || tx.description || 'Transaction Marqeta',
              ]
            );

            console.log(`💳 Transaction enregistrée pour l'utilisateur ${userId}`);
          }
        }
        break;

     case 'authorization':
  const auth = event.authorization;

  if (auth && auth.token && auth.user_token) {
    const userIdMatch = auth.user_token.match(/^user_(.+)$/);
    const cardIdMatch = auth.card_token?.match(/^card_(.+)$/);

    const userId = userIdMatch?.[1] ?? null;
    const cardId = cardIdMatch?.[1] ?? null;

    await pool.query(
      `INSERT INTO authorizations (
        user_id, card_id, marqeta_authorization_id, state, amount, currency,
        merchant, merchant_country, merchant_city, merchant_category, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
      [
        userId,
        cardId,
        auth.token,
        auth.state,
        auth.amount,
        auth.currency || 'USD',
        auth.merchant_descriptor || auth.merchant?.name || null,
        auth.merchant?.country || null,
        auth.merchant?.city || null,
        auth.merchant?.category || null
      ]
    );

    console.log(`🔐 Autorisation enregistrée pour user ${userId}, card ${cardId}`);
  }
  break;


      default:
        console.warn(`❗ Type d'événement non géré: ${event.type}`);
    }

    res.status(200).json({ received: true });
  } catch (error: any) {
    console.error('❌ Erreur traitement webhook Marqeta:', error.message);
    res.status(500).json({ error: error.message });
  }
};
