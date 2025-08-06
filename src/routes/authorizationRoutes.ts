import express from 'express';
import { getAuthorizations } from '../controllers/authorizationController';
import { verifyToken } from '../middlewares/verifyToken';

const router = express.Router();

router.get('/authorizations', verifyToken, getAuthorizations);

export default router;
