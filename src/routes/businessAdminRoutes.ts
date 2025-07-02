import { Router } from 'express';
import { approveBusinessAccount } from '../controllers/businessAdminController';

const router = Router();

router.post('/business-approve', approveBusinessAccount);
// ... autres routes business admin

export default router;
