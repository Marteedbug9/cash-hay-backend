import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-06-30.basil',  // <-- Comma was missing here
  timeout: 20000,
  maxNetworkRetries: 3
});

export default stripe;