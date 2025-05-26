// src/routes/authRoutes.ts
import { Router } from 'express';
import {
  login,
  register,
  getProfile,
  uploadIdentity,
  startRecovery,
  verifyEmailForRecovery,
  resetPassword,
  confirmSuspiciousAttempt
} from '../controllers/authController';

import verifyToken from '../middlewares/verifyToken';
import upload from '../middlewares/upload';

const router = Router();

// ➤ Auth
router.post('/register', register);
router.post('/login', login);
router.get('/profile', verifyToken, getProfile);

// ➤ Récupération compte (OTP)
router.post('/recovery/start', startRecovery);
router.post('/recovery/verify-email', verifyEmailForRecovery);
router.post('/recovery/reset', resetPassword);

// ➤ Vérification identité avec photo & pièce (protégé par token)
router.post(
  '/verify-identity',
  verifyToken,
  upload.fields([
    { name: 'face', maxCount: 1 },
    { name: 'document', maxCount: 1 }
  ]),
  uploadIdentity // ✅ Pas besoin de cast, le type `req.files` est intégré
);

router.post('/confirm-suspicious-attempt', confirmSuspiciousAttempt);

export default router;
