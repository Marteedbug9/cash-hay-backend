import { Router } from 'express';
import { login, register, getProfile } from '../controllers/authController';
import verifyToken from '../middlewares/verifyToken';


const router = Router();

// Route pour inscription
router.post('/register', register);

// Route pour connexion
router.post('/login', login);

// Route protégée : récupérer les infos du profil
router.get('/profile', verifyToken, getProfile);

export default router;
