import { Router } from 'express';
import { startAddressMail, verifyAddressMail, statusAddressMail } from '../controllers/adminController';
import { verifyToken } from '../middlewares/verifyToken';

const router = Router();
router.post('/address-mail/start', verifyToken, startAddressMail);
router.post('/address-mail/verify', verifyToken, verifyAddressMail);
router.get('/address-mail/status', verifyToken, statusAddressMail); // 👈 nouveau
export default router;
