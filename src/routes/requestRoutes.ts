import { Router } from 'express';
import {
  createRequest,
  getRequests,
} from '../controllers/requestController';
import { verifyToken } from '../middlewares/verifyToken';

const router = Router();

// ✅ Créer une nouvelle demande d'argent
router.post('/', verifyToken, createRequest);

// ✅ Récupérer les demandes envoyées ou reçues
router.get('/', verifyToken, getRequests);

export default router;
