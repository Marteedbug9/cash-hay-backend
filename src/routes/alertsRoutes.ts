// routes/alertsRoutes.ts
import express from 'express';
import { handleSMSReply } from '../controllers/alertsController';
const router = express.Router();

router.post('/sms-response', handleSMSReply); // 📥 Webhook de Twilio

export default router;
