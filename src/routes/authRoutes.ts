// src/routes/authRoutes.ts
import { Router } from 'express';
import { login, register, getProfile, uploadIdentity } from '../controllers/authController';
import verifyToken from '../middlewares/verifyToken';
import upload from '../middlewares/upload';
import { MulterRequest } from '../types'; // ✅ Assure que ce fichier existe

const router = Router();

// ➤ Route pour inscription
router.post('/register', register);

// ➤ Route pour connexion
router.post('/login', login);

// ➤ Route protégée : profil utilisateur
router.get('/profile', verifyToken, getProfile);

// ✅ Route protégée : Upload identité (photo de visage + pièce d'identité)
router.post(
  '/verify-identity',
  verifyToken,
  upload.fields([
    { name: 'face', maxCount: 1 },
    { name: 'document', maxCount: 1 }
  ]),
  (req, res) => uploadIdentity(req as MulterRequest, res)
);

export default router;
