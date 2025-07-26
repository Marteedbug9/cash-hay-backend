import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-06-30.basil", // Doit être EXACTEMENT ce texte
  typescript: true,
  timeout: 20000,
});

async function verifyStripeConnection() {
  try {
    await stripe.customers.list({ limit: 1 });
    console.log('✅ Connexion Stripe validée');
  } catch (error) {
    console.error('❌ Échec de connexion à Stripe:', error);
    throw new Error('Configuration Stripe invalide');
  }
}

if (process.env.NODE_ENV !== 'production') {
  verifyStripeConnection().catch(console.error);
}

export default stripe;
