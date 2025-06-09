// src/routes/cardRoutes.ts
import { Router } from 'express';
import {
  requestCard,
  cancelCard,
  toggleCardLock,
} from '../controllers/cardController';
import { verifyToken } from '../middlewares/verifyToken';

const router = Router();

router.post('/request', verifyToken, requestCard);
router.post('/cancel', verifyToken, cancelCard);
router.post('/toggle-lock', verifyToken, toggleCardLock);

export default router;