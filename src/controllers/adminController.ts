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
        m.contact AS member_contact
      FROM users u
      LEFT JOIN profile_images pi ON pi.user_id = u.id AND pi.is_current = true
      LEFT JOIN members m ON m.user_id = u.id
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
    const { rows } = await pool.query(`
      SELECT 
        u.id, u.username, u.email, u.phone, u.first_name, u.last_name, u.address,
        u.birth_date, u.birth_country, u.birth_place, u.id_type, u.id_number, 
        u.id_issue_date, u.id_expiry_date, u.role, u.is_verified, 
        u.identity_verified, u.is_blacklisted, u.is_deceased, u.city, u.department, u.country, u.zip_code, 
        u.face_url, u.document_url,
        pi.url AS profile_image,
        m.contact AS member_contact,
        c.card_number, c.type AS card_type, c.status AS card_status, c.expiry_date, c.created_at as card_created_at
      FROM users u
      LEFT JOIN profile_images pi ON pi.user_id = u.id AND pi.is_current = true
      LEFT JOIN members m ON m.user_id = u.id
      LEFT JOIN cards c ON c.user_id = u.id AND c.status IN ('active', 'pending')
      WHERE u.id = $1
      LIMIT 1
    `, [id]);
    if (!rows.length) {
      return res.status(404).json({ error: 'Utilisateur non trouvé.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Erreur getUserDetail:', err);
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
