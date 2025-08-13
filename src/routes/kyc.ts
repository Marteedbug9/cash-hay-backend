// routes/kyc.ts
import { Router } from 'express';
import { startAddressMail, verifyAddressMail } from '../controllers/adminController'; // ou authController
import { verifyToken, verifyAdmin } from '../middlewares/verifyToken';

const router = Router();
router.post('/address-mail/start', verifyToken, startAddressMail);
router.post('/address-mail/verify', verifyToken, verifyAddressMail);
export default router;


