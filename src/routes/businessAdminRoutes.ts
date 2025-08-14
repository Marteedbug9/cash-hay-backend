// src/routes/businessAdminRoutes.ts
import { Router } from 'express';
import {
  approveBusinessAccount,
  rejectBusinessAccount,
  getPendingBusinessAccounts,
  getBusinessAccountById,
  updateBusinessAccountContact,
  deleteBusinessAccount,
} from '../controllers/businessAdminController';
import { verifyAdmin } from '../middlewares/verifyToken';

const router = Router();

/**
 * @route   GET /admin/business-accounts/pending
 * @desc    Liste tous les comptes business en attente d'approbation
 * @access  Admin
 */
router.get('/business-accounts/pending', verifyAdmin, getPendingBusinessAccounts);

/**
 * @route   GET /admin/business-accounts/:id
 * @desc    Récupère les détails d'un compte business
 * @access  Admin
 */
router.get('/business-accounts/:id', verifyAdmin, getBusinessAccountById);

/**
 * @route   POST /admin/business-accounts/approve
 * @desc    Approuve un compte business
 * @access  Admin
 */
router.post('/business-accounts/approve', verifyAdmin, approveBusinessAccount);

/**
 * @route   POST /admin/business-accounts/reject
 * @desc    Rejette un compte business
 * @access  Admin
 */
router.post('/business-accounts/reject', verifyAdmin, rejectBusinessAccount);

/**
 * @route   PUT /admin/business-accounts/:id/contact
 * @desc    Met à jour les informations de contact (email, téléphone, tax id)
 * @access  Admin
 */
router.put('/business-accounts/:id/contact', verifyAdmin, updateBusinessAccountContact);

/**
 * @route   DELETE /admin/business-accounts/:id
 * @desc    Supprime un compte business
 * @access  Admin
 */
router.delete('/business-accounts/:id', verifyAdmin, deleteBusinessAccount);

export default router;
