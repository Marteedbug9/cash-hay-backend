import { Router } from 'express';
import {
  requestCard,
  cancelCard,
  toggleCardLock
} from '../controllers/cardController';
import { authenticateToken } from '../middlewares/authMiddleware';


const router = Router();

router.post('/request', authenticateToken, requestCard);
router.post('/cancel', authenticateToken, cancelCard);
router.post('/lock', authenticateToken, toggleCardLock);

export default router;
