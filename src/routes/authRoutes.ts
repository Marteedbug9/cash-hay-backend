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
  confirmSuspiciousAttempt,
  verifyOTP,
  resendOTP,
  getBalance,
   transfer
} from '../controllers/authController';
import { deposit } from '../controllers/transactionController';

import { authenticateToken } from '../middlewares/authMiddleware';
import upload from '../middlewares/upload';

const router = Router();

// ➤ Auth
router.post('/register', register);
router.post('/login', login);
router.get('/profile', authenticateToken, getProfile);

// ➤ Solde
router.get('/balance', authenticateToken, getBalance);
router.post('/deposit', authenticateToken, deposit);
router.post('/transfer', authenticateToken, transfer);

// ➤ Récupération compte (OTP)
router.post('/recovery/start', startRecovery);
router.post('/recovery/verify-email', verifyEmailForRecovery);
router.post('/recovery/reset', resetPassword);

// ➤ Vérification identité avec photo & pièce (protégé par token)
router.post(
  '/verify-identity',
  authenticateToken,
  upload.fields([
    { name: 'face', maxCount: 1 },
    { name: 'document', maxCount: 1 }
  ]),
  uploadIdentity
);

// ➤ Vérification OTP
router.post('/verify-otp', verifyOTP);
router.post('/resend-otp', resendOTP);

// ➤ Confirmation de tentative suspecte
router.post('/confirm-suspicious-attempt', confirmSuspiciousAttempt);

export default router;
