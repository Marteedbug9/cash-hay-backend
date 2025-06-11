import express from 'express';
import { getMemberContact } from '../controllers/memberController';
import { verifyToken} from '../middlewares/verifyToken';

const router = express.Router();

router.get('/:memberId/contact', verifyToken, getMemberContact);

export default router;
