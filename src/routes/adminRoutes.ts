import { Router } from 'express';
import express from 'express';
import pool from '../config/db';
import { verifyToken, verifyAdmin } from '../middlewares/verifyToken';
import { getAllPhysicalCards,getUserCustomCards,allowCardRequest,approveCustomCard,getUserAllCards,markCardAsPrinted,getCardShippingInfoHandler,
  activatePhysicalCardHandler,getCardProducts, listMarqetaCardProducts  } from '../controllers/adminController';
import { handleMarqetaWebhook, } from '../webhooks/marqeta';
import { listCardProducts } from '../webhooks/marqetaService';


const router = Router();

// Route pour les webhooks Stripe (ne pas protéger par les middlewares normaux)
// Ajoute en haut
router.use(express.json()); // Appliquer à toutes les routes POST

router.post('/marqeta-webhook', handleMarqetaWebhook);

router.get('/cards/:id/shipping', verifyAdmin, getCardShippingInfoHandler);
router.post('/cards/:id/activate', verifyAdmin, activatePhysicalCardHandler);

router.get('/card-products', verifyAdmin, getCardProducts);
router.get('/cardproducts', verifyAdmin, async (req, res) => {
  try {
    const data = await listCardProducts();
    res.status(200).json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// ➤ Liste des utilisateurs (résumé)
router.get('/users', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
  u.id, u.username, u.email, u.phone, u.role, u.is_verified, u.is_blacklisted, u.is_deceased,
  u.identity_verified, u.created_at,
  pi.url as profile_photo,
  u.face_url, u.document_url,
  -- La dernière carte active
  (SELECT card_number FROM cards WHERE user_id = u.id AND status = 'active' ORDER BY requested_at DESC LIMIT 1) as card_number,
  (SELECT type FROM cards WHERE user_id = u.id AND status = 'active' ORDER BY requested_at DESC LIMIT 1) as card_type,
  -- Premier contact membre
  (SELECT contact FROM members WHERE user_id = u.id LIMIT 1) as member_contact
FROM users u
LEFT JOIN profile_images pi ON pi.user_id = u.id AND pi.is_current = true
ORDER BY u.created_at DESC

    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ➤ Détail complet d’un utilisateur
router.get('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    // Info user + photos + docs
    const userResult = await pool.query(`
      SELECT
        u.id, u.username, u.email, u.first_name, u.last_name, u.address, u.phone,
        u.birth_date, u.birth_country, u.birth_place, u.id_type, u.id_number,
        u.id_issue_date, u.id_expiry_date, u.role, u.is_verified, u.identity_verified,
        u.is_blacklisted, u.is_deceased, u.city, u.department, u.country, u.zip_code,
        u.created_at, u.face_url, u.document_url,
        pi.url as profile_photo
      FROM users u
      LEFT JOIN profile_images pi ON pi.user_id = u.id AND pi.is_current = true
      WHERE u.id = $1
    `, [id]);
    if (userResult.rowCount === 0) return res.status(404).json({ error: "Utilisateur non trouvé." });
    const user = userResult.rows[0];

    // Contacts membres
    const contacts = await pool.query(
      `SELECT contact FROM members WHERE user_id = $1`, [id]
    );
    user.contacts = contacts.rows.map(c => c.contact);

    // Cartes (virtuelles/physiques)
    const cardsRes = await pool.query(`
  SELECT 
    uc.id,
    uc.type,
    uc.category,
    uc.style_id,
    uc.price AS custom_price,
    uc.design_url,
    COALESCE(uc.design_url, ct.image_url) AS final_card_image,
    uc.is_printed,
    uc.created_at,
    uc.is_current,
    uc.is_approved,
    uc.approved_by,
    uc.approved_at,
    ct.label AS style_label,
    ct.price AS default_price,
    ct.image_url AS style_image_url,
    c.status,
    c.is_locked,
    c.created_at AS requested_at,
    c.type AS card_type,
    c.account_type
  FROM user_cards uc
  LEFT JOIN card_types ct ON uc.style_id = ct.type
  LEFT JOIN cards c ON uc.card_id = c.id
  WHERE uc.user_id = $1
  ORDER BY uc.created_at DESC
`, [id]);
user.cards = cardsRes.rows;


    // Historique transactions
    const transactions = await pool.query(
      `SELECT id, type, amount, currency, status, description, recipient_id, created_at
       FROM transactions WHERE user_id = $1 OR recipient_id = $1
       ORDER BY created_at DESC LIMIT 50`, [id]
    );
    user.transactions = transactions.rows;

    // Audit logs
    const logs = await pool.query(
      `SELECT action, created_at, details, ip_address, user_agent
       FROM audit_logs WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 20`, [id]
    );
    user.audit_logs = logs.rows;

    res.json(user);
  } catch (err) {
    console.error('❌ Erreur récupération utilisateur :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ➤ Activer / désactiver un compte
router.patch('/users/:id/verify', verifyToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  const { is_verified } = req.body;
  try {
    await pool.query('UPDATE users SET is_verified = $1 WHERE id = $2', [is_verified, id]);
    // Audit
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)`,
      [id, 'update_verification', `is_verified: ${is_verified}`]
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
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)`,
      [id, 'update_status', `blacklisted: ${is_blacklisted}, deceased: ${is_deceased}`]
    );
    res.json({ message: 'Statut mis à jour avec succès.' });
  } catch (err) {
    res.status(503).json({ error: 'Erreur serveur.' });
  }
});

// ➤ Valider identité
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
    if (result.rowCount === 0) return res.status(404).json({ error: "Utilisateur non trouvé." });
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)`,
      [id, 'validate_identity', 'Identité validée manuellement par admin']
    );
    res.status(200).json({
      message: 'Identité validée avec succès.',
      user: result.rows[0],
    });
  } catch (err) {
    res.status(504).json({ error: 'Erreur lors de la validation.' });
  }
});

// ➤ Réactiver la soumission identité
router.patch('/users/:id/identity/request-enable', verifyToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE users SET identity_request_enabled = true WHERE id = $1 RETURNING id, username, identity_request_enabled`,
      [id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Utilisateur non trouvé." });
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)`,
      [id, 'reactivate_identity_request', 'Réactivation manuelle de la soumission d’identité']
    );
    res.json({ message: "Soumission d'identité réactivée.", user: result.rows[0] });
  } catch (err) {
    res.status(505).json({ error: "Erreur lors de la réactivation." });
  }
});

// ➤ Réactiver vérification d'identité
router.patch('/users/:id/identity/reactivate', verifyToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(`UPDATE users SET identity_request_enabled = true WHERE id = $1`, [id]);
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)`,
      [id, 'identity_reactivation', 'Réactivation de l’envoi d’identité par admin']
    );
    res.json({ message: 'Réactivation de la vérification autorisée.' });
  } catch (err) {
    res.status(505).json({ error: 'Erreur lors de la réactivation.' });
  }
});

// ➤ Voir toutes les cartes d'un user
router.get('/users/:id/cards', verifyToken, verifyAdmin, async (req, res) => { 
  const { id } = req.params;
  try {
    const cardsRes = await pool.query(`
      SELECT 
        uc.id,
        uc.type,
        uc.category,
        uc.style_id,
        uc.price AS custom_price,
        uc.design_url,
        COALESCE(uc.design_url, ct.image_url) AS final_card_image,
        uc.is_printed,
        uc.created_at,
        uc.is_current,
        uc.is_approved,
        uc.approved_by,
        uc.approved_at,
        ct.label AS style_label,
        ct.price AS default_price,
        ct.image_url AS style_image_url,
        c.status,
        c.is_locked,
        c.created_at AS requested_at,
        c.type AS card_type,
        c.account_type
      FROM user_cards uc
      LEFT JOIN card_types ct ON uc.style_id = ct.type
      LEFT JOIN cards c ON uc.card_id = c.id
      WHERE uc.user_id = $1
      ORDER BY uc.created_at DESC
    `, [id]);
    // Ajoute ce log pour voir ce que la requête retourne vraiment
    console.log('🟢 Cartes SQL pour user', id, ':', cardsRes.rows);

    res.json(cardsRes.rows);
  } catch (err) {
    console.error('❌ Erreur SQL cartes:', err); // Ajoute un log d’erreur plus visible
    res.status(500).json({ error: 'Erreur chargement cartes.' });
  }
});



// ➤ Voir les audits d'un user
router.get('/users/:id/audit', verifyToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const logs = await pool.query(
      `SELECT action, created_at, details, ip_address, user_agent
       FROM audit_logs WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 50`, [id]
    );
    res.json(logs.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur audit.' });
  }
});

// ➤ Voir l’historique de connexion d'un user
router.get('/users/:id/logins', verifyToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const logins = await pool.query(
      `SELECT ip_address, created_at FROM login_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`, [id]
    );
    res.json(logins.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur login history.' });
  }
});

// ➤ Voir tous les membres d'un user (contacts)
router.get('/users/:id/contacts', verifyToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const contacts = await pool.query(
      `SELECT display_name, contact, created_at FROM members WHERE user_id = $1 ORDER BY created_at DESC`, [id]
    );
    res.json(contacts.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur contacts.' });
  }
});

router.post('/users/:id/unblock-otp', verifyToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM otp_blocks WHERE user_id = $1', [id]);
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, details)
       VALUES ($1, $2, $3)`,
      [id, 'unblock_otp', 'Déblocage manuel OTP effectué par un administrateur']
    );
    res.json({ message: 'Utilisateur débloqué pour OTP.' });
  } catch (err) {
    console.error('Erreur lors du déblocage OTP admin:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.get('/cards/physical', verifyToken,verifyAdmin, getAllPhysicalCards);

router.get('/users/:id/custom-cards', verifyAdmin, getUserCustomCards);

router.post('/users/:id/allow-card', verifyToken, verifyAdmin, allowCardRequest);


router.put('/cards/custom/:cardId/approve', verifyToken, verifyAdmin, approveCustomCard);

router.get('/users/:id/cards/full', verifyAdmin, getUserAllCards);


router.put('/cards/:cardId/mark-printed', verifyAdmin, markCardAsPrinted);


export default router;
