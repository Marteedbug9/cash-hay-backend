import express from 'express';
import {
  register,
  login,
  getProfile,
  startRecovery,
  verifyEmailForRecovery,
  resetPassword
} from '../controllers/authController'; // ✔️ Tous viennent d’ici

import { authenticateToken } from '../middlewares/authMiddleware';

const router = express.Router();

// 🔐 Authentification
router.post('/register', register);
router.post('/login', login);
router.get('/profile', authenticateToken, getProfile);

// 🔁 Récupération de mot de passe
router.post('/recovery/start', startRecovery);
router.post('/recovery/verify-email', verifyEmailForRecovery);
router.post('/recovery/reset-password', resetPassword);

export default router;
