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
  getSecurityInfo,
  savePushToken,
  changePassword,
  changeUsername,
  searchUserByContact
} from '../controllers/authController';
import upload from '../middlewares/upload';
import { verifyToken } from '../middlewares/verifyToken';
import pool from '../config/db';
import { blindIndexEmail, blindIndexPhone } from '../utils/crypto';

const router = Router();

/* ------------------------ Authentification ------------------------ */
router.post('/register', register);
router.post('/login', login);
router.get('/profile', verifyToken, getProfile);

/* ---------------------- Recherche utilisateur --------------------- */
router.post('/search-user', verifyToken, searchUserByContact);

/* --------------------- Récupération de compte --------------------- */
router.post('/recovery/start', startRecovery);
router.post('/recovery/verify-email', verifyEmailForRecovery);
router.post('/recovery/reset', resetPassword);

/* ------------------------ Upload identité ------------------------- */
router.post(
  '/verify-identity',
  verifyToken,
  upload.fields([
    { name: 'face', maxCount: 1 },
    { name: 'document', maxCount: 1 }
  ]),
  uploadIdentity
);

/* ----------------------- OTP après login -------------------------- */
router.post('/verify-otp', verifyOTP);
router.post('/resend-otp', resendOTP);

/* ----------------- OTP / Vérifs pour inscription ------------------ */
router.post('/send-otp-register', sendOTPRegister);
// si l’OTP de création de compte doit être protégé, garde verifyToken. Sinon, enlève-le.
router.post('/verify-otp-register', verifyToken, verifyOTPRegister);
router.post('/check-member', verifyToken, checkMember);

/* ---------------------- Push token & Sécurité --------------------- */
router.post('/push-token', verifyToken, savePushToken);
router.get('/security-info', verifyToken, getSecurityInfo);
router.patch('/change-username', verifyToken, changeUsername);
router.patch('/change-password', verifyToken, changePassword);

/* ---------------- Confirmation tentative suspecte ----------------- */
router.post('/confirm-suspicious-attempt', confirmSuspiciousAttempt);

/* ------------------------ Photo de profil ------------------------- */
router.post('/upload-profile-image', verifyToken, upload.single('image'), uploadProfileImage);

/* ------------------- Vérification d’unicité champs ---------------- */
router.post('/check-unique', async (req, res) => {
  const { field, value } = req.body as { field?: 'username' | 'email' | 'phone'; value?: string };

  // Validation basique
  if (!field || typeof value !== 'string' || !value.trim()) {
    return res.status(400).json({ error: 'Champ et valeur requis.' });
  }

  // Autoriser uniquement ces champs
  const allowed = ['username', 'email', 'phone'] as const;
  if (!allowed.includes(field)) {
    return res.status(400).json({ error: "Champ invalide. Utilisez 'username', 'email' ou 'phone'." });
  }

  const input = value.trim();
  try {
    let exists = false;

    switch (field) {
      case 'username': {
        // comparaison insensible à la casse
        const result = await pool.query(
          'SELECT 1 FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1',
          [input]
        );
        exists = result.rows.length > 0;
        break;
      }

      case 'email': {
        // unicité via blind index
        const bidx = blindIndexEmail(input);
        const result = await pool.query(
          'SELECT 1 FROM users WHERE email_bidx = $1 LIMIT 1',
          [bidx]
        );
        exists = result.rows.length > 0;
        break;
      }

      case 'phone': {
        // unicité via blind index (normalisation dans blindIndexPhone)
        const bidx = blindIndexPhone(input);
        const result = await pool.query(
          'SELECT 1 FROM users WHERE phone_bidx = $1 LIMIT 1',
          [bidx]
        );
        exists = result.rows.length > 0;
        break;
      }
    }

    return res.json({ isUnique: !exists });
  } catch (err) {
    console.error('Erreur check-unique:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
