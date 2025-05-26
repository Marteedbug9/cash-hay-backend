import { Router } from 'express';
import { authenticateToken, verifyAdmin } from '../middlewares/authMiddleware';
import pool from '../config/db';

const router = Router();

// ➤ Voir tous les utilisateurs
router.get('/users', authenticateToken, verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id, username, email, role,
        is_verified, is_blacklisted, is_deceased
      FROM users
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(501).json({ error: 'Erreur serveur.' });
  }
});

// ➤ Activer / désactiver un compte
router.patch('/users/:id/verify', authenticateToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  const { is_verified } = req.body;

  try {
    await pool.query(
      'UPDATE users SET is_verified = $1 WHERE id = $2',
      [is_verified, id]
    );
    res.json({ message: `Utilisateur ${is_verified ? 'activé' : 'désactivé'} avec succès.` });
  } catch (err) {
    res.status(502).json({ error: 'Erreur serveur.' });
  }
});

// ➤ Liste noire / Décès
router.patch('/users/:id/status', authenticateToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  const { is_blacklisted, is_deceased } = req.body;

  try {
    await pool.query(
      'UPDATE users SET is_blacklisted = $1, is_deceased = $2 WHERE id = $3',
      [is_blacklisted, is_deceased, id]
    );
    res.json({ message: 'Statut mis à jour avec succès.' });
  } catch (err) {
    res.status(503).json({ error: 'Erreur serveur.' });
  }
});

export default router;
