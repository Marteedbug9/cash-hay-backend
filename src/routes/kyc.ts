import { Router } from 'express';
import { startAddressMail, verifyAddressMail } from '../controllers/adminController';
import { initAddressMail, statusAddressMail } from '../controllers/adminController';
import { verifyToken } from '../middlewares/verifyToken';

const router = Router();

router.get('/address-mail/init', verifyToken, initAddressMail);     // 👈 nouvel endpoint
router.get('/address-mail/status', verifyToken, statusAddressMail); // si tu l’as déjà

router.post('/address-mail/start', verifyToken, startAddressMail);
router.post('/address-mail/verify', verifyToken, verifyAddressMail);

export default router;
