import { Router } from 'express';
import pool from '../config/db';
import { verifyToken,verifyAdmin } from '../middlewares/verifyToken';


const router = Router();

// ➤ Voir tous les utilisateurs
router.get('/users', verifyToken, verifyAdmin, async (req, res) => {
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
router.patch('/users/:id/verify', verifyToken, verifyAdmin, async (req, res) => {
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
router.patch('/users/:id/status', verifyToken, verifyAdmin, async (req, res) => {
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



// ✅ Validation manuelle d'identité
router.patch('/users/:id/identity/validate', verifyToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `UPDATE users 
       SET identity_verified = true, 
           is_verified = true,
           verified_at = NOW(),
           identity_request_enabled = true
       WHERE id = $1
       RETURNING id, username, email, identity_verified, is_verified, verified_at`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Utilisateur non trouvé." });
    }

    // 🔍 Log audit
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, details)
       VALUES ($1, $2, $3)`,
      [id, 'validate_identity', 'Identité validée manuellement par admin']
    );

    return res.status(200).json({
      message: 'Identité validée avec succès.',
      user: result.rows[0],
    });

  } catch (err) {
    console.error('❌ Erreur validation identité:', err);
    res.status(504).json({ error: 'Erreur lors de la validation de l’identité.' });
  }
});


// ➤ Réactivation soumission identité
router.patch('/users/:id/identity/request-enable', verifyToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `UPDATE users 
       SET identity_request_enabled = true 
       WHERE id = $1
       RETURNING id, username, identity_request_enabled`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Utilisateur non trouvé." });
    }

    // 🔍 Audit log
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, details)
       VALUES ($1, $2, $3)`,
      [id, 'reactivate_identity_request', 'Réactivation manuelle de la soumission d’identité']
    );

    res.json({
      message: "Soumission d'identité réactivée.",
      user: result.rows[0],
    });

  } catch (err) {
    console.error('❌ Erreur réactivation soumission identité:', err);
    res.status(505).json({ error: "Erreur lors de la réactivation." });
  }
});

// ➤ Réactiver l'envoi d'identité (admin)
router.patch('/users/:id/identity/reactivate', verifyToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query(
      `UPDATE users SET identity_request_enabled = true WHERE id = $1`,
      [id]
    );
    res.json({ message: 'Réactivation de la vérification autorisée.' });
  } catch (err) {
    console.error('❌ Erreur réactivation identité:', err);
    res.status(505).json({ error: 'Erreur lors de la réactivation.' });
  }
});

// ➤ Détails d’un utilisateur sans mot de passe ni documents
router.get('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT 
         id, username, email, first_name, last_name, address, phone,
         birth_date, birth_country, birth_place, id_type, id_number,
         id_issue_date, id_expiry_date, role, is_verified, identity_verified,
         is_blacklisted, is_deceased, city, department, country, zip_code,
         created_at
       FROM users
       WHERE id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé.' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Erreur récupération utilisateur :', err);
    res.status(500).json({ error: 'Erreur serveur lors de la récupération.' });
  }
});


export default router;
