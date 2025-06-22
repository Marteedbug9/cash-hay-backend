// src/routes/cardRoutes.ts
import { Router } from 'express';
import {
   requestCard,
  toggleCardLock,
  cancelCard,
  requestPhysicalCard,
  saveCustomCard,
  getUserCards,
  getCurrentCard
} from '../controllers/cardController';
import { verifyToken } from '../middlewares/verifyToken';

const router = Router();

router.post('/request', verifyToken, requestCard);
router.post('/cancel', verifyToken, cancelCard);
router.post('/toggle-lock', verifyToken, toggleCardLock);
router.post('/request-physical', verifyToken, requestPhysicalCard);

// 🖌️ Cartes personnalisées
router.post('/customize', verifyToken, saveCustomCard);
router.get('/my', verifyToken, getUserCards);
router.get('/current', verifyToken, getCurrentCard);

export default router;
