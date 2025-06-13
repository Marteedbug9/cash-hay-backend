import { Router } from 'express';
import { listNotifications, clearNotifications, getNotifications } from '../controllers/notificationsController';
import { verifyToken } from '../middlewares/verifyToken';

const router = Router();

router.get('/', verifyToken, listNotifications);       // GET /api/notifications
router.delete('/', verifyToken, clearNotifications);   // DELETE /api/notifications
router.get('/all', verifyToken, getNotifications);     // GET /api/notifications/all

export default router;
