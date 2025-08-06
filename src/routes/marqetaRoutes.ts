// src/routes/marqetaRoutes.ts
import express from 'express';
import { createCardholder } from '../config/marqetaService';

const router = express.Router();

router.post('/marqeta/cardholder', createCardholder);

export default router;
