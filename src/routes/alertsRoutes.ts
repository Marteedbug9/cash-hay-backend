import express from 'express';
import { handleSMSReply } from '../controllers/alertsController';

const router = express.Router();

// Webhook pour Twilio
router.post('/sms-response', handleSMSReply);

export default router;