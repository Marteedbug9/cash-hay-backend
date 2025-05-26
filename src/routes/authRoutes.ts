import { Router } from 'express';
import {
  login,
  register,
  getProfile,
  uploadIdentity,
  startRecovery,
  verifyEmailForRecovery,
  resetPassword
} from '../controllers/authController';

import verifyToken from '../middlewares/verifyToken';
import upload from '../middlewares/upload';
import { MulterRequest } from '../types'; // Ce type doit exister dans src/types.ts
import { confirmSuspiciousAttempt } from '../controllers/authController';



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
  (req, res) => uploadIdentity(req as MulterRequest, res)
);
router.post('/confirm-suspicious-attempt', confirmSuspiciousAttempt);
export default router;
