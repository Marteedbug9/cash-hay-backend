import express from 'express';
import {
  listNotifications,
  clearNotifications,
} from '../controllers/notificationsController';
import {verifyToken } from '../middlewares/verifyToken';

const router = express.Router();

// GET /api/notifications - Liste toutes les notifications de l'utilisateur connecté
router.get('/', verifyToken, listNotifications);

// DELETE /api/notifications - Vider toutes les notifications de l'utilisateur connecté
router.delete('/', verifyToken, clearNotifications);

export default router;
