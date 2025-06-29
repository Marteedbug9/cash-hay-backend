import { Request, Response } from 'express';
import pool from '../config/db';

// ➤ Liste tous les utilisateurs (avec info membre, profil, carte, etc.)
export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const users = await pool.query(`
      SELECT 
        u.id, u.username, u.email, u.phone, u.role, u.is_verified, 
        u.is_blacklisted, u.is_deceased, u.identity_verified, u.created_at,
        pi.url AS profile_image,
        m.contact AS member_contact,
        c.design_url AS card_design,
        c.type AS card_type,
        c.created_at AS card_requested_at
      FROM users u
      LEFT JOIN profile_images pi ON pi.user_id = u.id AND pi.is_current = true
      LEFT JOIN members m ON m.user_id = u.id

      LEFT JOIN LATERAL (
        SELECT *
        FROM user_cards
        WHERE user_id = u.id AND type = 'physique'
        ORDER BY created_at DESC
        LIMIT 1
      ) c ON true

      ORDER BY u.created_at DESC
    `);

    res.json(users.rows);
  } catch (err) {
    console.error('Erreur getAllUsers:', err);
    res.status(501).json({ error: 'Erreur serveur.' });
  }
};


// ➤ Détail complet d'un utilisateur (pour AdminUserDetailScreen)
export const getUserDetail = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    // 1. Info principale de l'utilisateur
    const userRes = await pool.query(`
      SELECT 
        u.id, u.username, u.email, u.phone, u.first_name, u.last_name, u.address,
        u.birth_date, u.birth_country, u.birth_place, u.id_type, u.id_number, 
        u.id_issue_date, u.id_expiry_date, u.role, u.is_verified, 
        u.identity_verified, u.is_blacklisted, u.is_deceased, u.city, u.department, u.country, u.zip_code, 
        u.face_url, u.document_url,
        pi.url AS profile_photo
      FROM users u
      LEFT JOIN profile_images pi ON pi.user_id = u.id AND pi.is_current = true
      WHERE u.id = $1
      LIMIT 1
    `, [id]);

    if (!userRes.rows.length) {
      return res.status(404).json({ error: 'Utilisateur non trouvé.' });
    }

    const user = userRes.rows[0];

    // 2. Contacts liés (members.contact)
    const contactsRes = await pool.query(
      `SELECT contact FROM members WHERE user_id = $1`,
      [id]
    );
    user.contacts = contactsRes.rows.map(row => row.contact);

    // 3. Cartes (user_cards + card_types + cards)
    const cardsRes = await pool.query(`
      SELECT 
        uc.id,
        uc.type,
        uc.style_id,
        uc.price AS custom_price,
        uc.design_url, -- ✅ Important pour afficher l’image
        uc.created_at,
        uc.is_current,
        uc.is_approved,
        uc.approved_by,
        uc.approved_at,
        ct.label AS style_label,
        ct.price AS default_price,
        c.status,
        c.is_locked,
        c.card_number,
        c.expiry_date,
        c.created_at AS requested_at
      FROM user_cards uc
      LEFT JOIN card_types ct ON uc.style_id = ct.type
      LEFT JOIN cards c ON uc.card_id = c.id
      WHERE uc.user_id = $1
      ORDER BY uc.created_at DESC
    `, [id]);
    user.cards = cardsRes.rows;

    // 4. Audit logs
    const auditRes = await pool.query(
      `SELECT * FROM audit_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`,
      [id]
    );
    user.audit_logs = auditRes.rows;

    // ✅ Résultat final
    res.json(user);
  } catch (err) {
    console.error('❌ Erreur getUserDetail:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};


// ➤ Activer / désactiver un compte utilisateur
export const setUserVerified = async (req: Request, res: Response) => {
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
};

// ➤ Liste noire / Décès
export const setUserStatus = async (req: Request, res: Response) => {
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
};

// ➤ Valider identité
export const validateIdentity = async (req: Request, res: Response) => {
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
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, details)
       VALUES ($1, $2, $3)`,
      [id, 'validate_identity', 'Identité validée manuellement par admin']
    );
    res.json({ message: 'Identité validée avec succès.', user: result.rows[0] });
  } catch (err) {
    res.status(504).json({ error: 'Erreur lors de la validation de l’identité.' });
  }
};

// ➤ Réactiver la soumission d'identité (admin)
export const reactivateIdentityRequest = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE users SET identity_request_enabled = true WHERE id = $1 RETURNING id, username, identity_request_enabled`,
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Utilisateur non trouvé." });
    }
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, details)
       VALUES ($1, $2, $3)`,
      [id, 'reactivate_identity_request', 'Réactivation manuelle de la soumission d’identité']
    );
    res.json({ message: "Soumission d'identité réactivée.", user: result.rows[0] });
  } catch (err) {
    res.status(505).json({ error: "Erreur lors de la réactivation." });
  }
};

// ➤ Débloquer un utilisateur bloqué pour OTP
export const unblockUserOTP = async (req: Request, res: Response) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'ID utilisateur requis.' });
  }
  try {
    const result = await pool.query('DELETE FROM otp_blocks WHERE user_id = $1', [userId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Aucun blocage trouvé pour cet utilisateur.' });
    }
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, details)
       VALUES ($1, $2, $3)`,
      [userId, 'unblock_otp', 'Déblocage OTP effectué par admin']
    );
    return res.status(200).json({ message: 'Utilisateur débloqué avec succès.' });
  } catch (err) {
    console.error('❌ Erreur lors du déblocage OTP:', err);
    return res.status(500).json({ error: 'Erreur serveur lors du déblocage.' });
  }
};

export const getAllPhysicalCards = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT uc.*, u.first_name, u.last_name, u.email
       FROM user_cards uc
       JOIN users u ON uc.user_id = u.id
       WHERE uc.type = 'physique'
       ORDER BY uc.created_at DESC`
    );
    res.status(200).json({ cards: result.rows });
  } catch (err) {
    console.error('❌ Erreur récupération cartes physiques:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ➤ Récupère toutes les cartes personnalisées d’un utilisateur
export const getUserCustomCards = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT style_id, type, price, design_url, created_at
       FROM user_cards
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [id]
    );
    res.status(200).json({ cards: result.rows });
  } catch (err) {
    console.error('❌ Erreur récupération cartes perso:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

export const allowCardRequest = async (req: Request, res: Response) => {
  const userId = req.params.id;

  try {
    await pool.query(
      `UPDATE users SET card_request_allowed = true WHERE id = $1`,
      [userId]
    );
    res.json({ message: 'L’utilisateur peut à nouveau demander une carte.' });
  } catch (err) {
    console.error('❌ Erreur admin autorisation:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

export const approveCustomCard = async (req: Request, res: Response) => {
  const { cardId } = req.params;
  const adminId = req.user?.id;

  try {
    const result = await pool.query(
      `UPDATE user_cards
       SET is_approved = true, approved_by = $1, approved_at = NOW()
       WHERE id = $2 AND type = 'physique'
       RETURNING *`,
      [adminId, cardId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Carte non trouvée ou déjà approuvée." });
    }

    return res.json({ message: "Carte personnalisée approuvée avec succès." });
  } catch (err) {
    console.error('❌ Erreur approbation carte personnalisée :', err);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

export const getUserAllCards = async (req: Request, res: Response) => {
  const { id } = req.params; // user_id

  try {
    const result = await pool.query(
      `SELECT 
         uc.id AS user_card_id,
         uc.type AS custom_type,
         uc.design_url,
         uc.price AS custom_price,
         uc.label,
         uc.created_at AS design_created_at,
         uc.is_approved,
         uc.approved_by,
         uc.approved_at,
         c.id AS card_id,
         c.type AS real_card_type,
         c.status AS card_status,
         c.card_number,
         c.expiry_date,
         c.created_at AS card_created_at,
         c.is_locked,
         ct.label AS style_label,
         ct.price AS default_style_price
       FROM user_cards uc
       LEFT JOIN cards c ON uc.card_id = c.id
       LEFT JOIN card_types ct ON LOWER(uc.style_id) = LOWER(ct.type)
       WHERE uc.user_id = $1
       ORDER BY uc.created_at DESC`,
      [id]
    );

    res.json({ cards: result.rows });
  } catch (err) {
    console.error('❌ Erreur récupération toutes les cartes:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};
