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
  verifyOTPRegister,
  sendOTPRegister,
  checkMember,
  savePushToken,
  searchUserByContact
} from '../controllers/authController';
import upload from '../middlewares/upload';
import { verifyToken } from '../middlewares/verifyToken';
import pool from '../config/db';


const router = Router();

// Authentification
router.post('/register', register);
router.post('/login', login);
router.get('/profile', verifyToken, getProfile);

// Recherche utilisateur
router.post('/search-user', verifyToken, searchUserByContact);

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

// ➕ Ajouter ceci pour l’inscription rapide
router.post('/send-otp-register', sendOTPRegister);
router.post('/verify-otp-register', verifyOTPRegister);
router.post('/check-member', verifyToken, checkMember);

router.post('/push-token', verifyToken, savePushToken);


// Confirmation tentative suspecte
router.post('/confirm-suspicious-attempt', confirmSuspiciousAttempt);

// Photo de profil
router.post('/upload-profile-image', verifyToken, upload.single('image'), uploadProfileImage);


router.post('/check-unique', async (req, res) => {
  const { field, value } = req.body;
  if (!field || !value) {
    return res.status(400).json({ error: 'Champ et valeur requis.' });
  }
  try {
    let exists = false;
    if (field === 'username') {
      const result = await pool.query('SELECT 1 FROM users WHERE username = $1', [value]);
      exists = !!result.rowCount;
    }
    if (field === 'email') {
      const result = await pool.query('SELECT 1 FROM users WHERE email = $1', [value]);
      exists = !!result.rowCount;
    }
    if (field === 'phone') {
      const result = await pool.query('SELECT 1 FROM users WHERE phone = $1', [value]);
      exists = !!result.rowCount;
    }
    return res.json({ isUnique: !exists });
  } catch (err) {
    console.error('Erreur check-unique:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
