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
  uploadProfileImage,
  searchUserByContact
} from '../controllers/authController';
import upload from '../middlewares/upload';
import { verifyToken } from '../middlewares/verifyToken';

const router = Router();

// Authentification
router.post('/register', register);
router.post('/login', login);
router.get('/profile', verifyToken, getProfile);

// Recherche utilisateur
router.get('/search', verifyToken, searchUserByContact);

// Récupération de compte / OTP
router.post('/recovery/start', startRecovery);
router.post('/recovery/verify-email', verifyEmailForRecovery);
router.post('/recovery/reset', resetPassword);

// Upload identité
router.post(
  '/verify-identity',
  verifyToken,
  upload.fields([
    { name: 'face', maxCount: 1 },
    { name: 'document', maxCount: 1 }
  ]),
  uploadIdentity
);

// OTP après login
router.post('/verify-otp', verifyOTP);
router.post('/resend-otp', resendOTP);

// Confirmation tentative suspecte
router.post('/confirm-suspicious-attempt', confirmSuspiciousAttempt);

// Photo de profil
router.post('/upload-profile-image', verifyToken, upload.single('image'), uploadProfileImage);

export default router;
