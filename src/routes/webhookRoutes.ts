// src/routes/webhookRoutes.ts
import express from 'express';
import { verifyMarqetaAuth } from '../middlewares/handleMarqetaWebhook';
import { handleMarqetaWebhook } from '../webhooks/marqeta';

const router = express.Router();

router.post('/marqeta/webhook', verifyMarqetaAuth, handleMarqetaWebhook);

export default router;
