import { Router } from 'express';
import { getNotifications, clearNotifications } from '../controllers/notificationsController';
import { verifyToken } from '../middlewares/verifyToken';

const router = Router();

// ✅ Liste toutes les notifications de l'utilisateur
router.get('/', verifyToken, getNotifications); // GET /api/notifications

// ✅ Supprime toutes les notifications
router.delete('/', verifyToken, clearNotifications); // DELETE /api/notifications



export default router;
