// src/routes/cardRoutes.ts
import { Router } from 'express';
import {
   requestVirtualCard,
  toggleCardLock,
  cancelCard,
  requestPhysicalCard,
  saveCustomCard,
  getUserCards,
  getCurrentCard,
  activateCard,
  selectCardModel,
  getLatestCustomCard,
  assignPhysicalCard,
  hasCard,
  requestPhysicalCustomCard
} from '../controllers/cardController';
import { verifyToken } from '../middlewares/verifyToken';

const router = Router();

router.post('/request', verifyToken, requestVirtualCard);
router.post('/cancel', verifyToken, cancelCard);
router.post('/toggle-lock', verifyToken, toggleCardLock);
router.post('/request-physical', verifyToken, requestPhysicalCard);

// 🖌️ Cartes personnalisées
router.post('/customize', verifyToken, saveCustomCard);
router.get('/my', verifyToken, getUserCards);
router.get('/current', verifyToken, getCurrentCard);

router.post('/activate', verifyToken, activateCard);
router.post('/select', verifyToken, selectCardModel);
router.get('/latest-custom', verifyToken, getLatestCustomCard);
router.post('/admin/assign-physical', verifyToken, assignPhysicalCard);
router.get('/has-card', verifyToken, hasCard);
router.post('/request-physical-custom', verifyToken, requestPhysicalCustomCard);




export default router;
