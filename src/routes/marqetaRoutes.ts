// src/routes/marqetaRoutes.ts
import express from 'express';
import { createCardholderController } from '../controllers/marqetaController';

const router = express.Router();

router.post('/marqeta/cardholder', createCardholderController);

export default router;
