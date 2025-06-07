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
  transfer,
  uploadProfileImage,
  searchUserByContact
} from '../controllers/authController';

import { deposit } from '../controllers/transactionController';
import { authenticateToken, verifyAdmin } from '../middlewares/authMiddleware';
import upload from '../middlewares/upload';

const router = Router();

// ✅ Authentification
router.post('/register', register);
router.post('/login', login);
router.get('/profile', authenticateToken, getProfile);

// 🔍 Recherche d’utilisateur (email/téléphone)
router.get('/search', authenticateToken, searchUserByContact);

// 💰 Solde et transactions de base
router.get('/balance', authenticateToken, getBalance);
router.post('/deposit', authenticateToken, deposit);
router.post('/transfer', authenticateToken, transfer);

// 🔐 Récupération de compte / OTP
router.post('/recovery/start', startRecovery);
router.post('/recovery/verify-email', verifyEmailForRecovery);
router.post('/recovery/reset', resetPassword);

// 📤 Upload identité (photo + pièce)
router.post(
  '/verify-identity',
  authenticateToken,
  upload.fields([
    { name: 'face', maxCount: 1 },
    { name: 'document', maxCount: 1 }
  ]),
  uploadIdentity
);

// 🔁 OTP après login
router.post('/verify-otp', verifyOTP);
router.post('/resend-otp', resendOTP);

// ⚠️ Confirmation de tentative suspecte
router.post('/confirm-suspicious-attempt', confirmSuspiciousAttempt);

// 👤 Photo de profil
router.post('/upload-profile-image', authenticateToken, upload.single('image'), uploadProfileImage);

export default router;
