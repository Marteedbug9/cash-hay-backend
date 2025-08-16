// src/controllers/adminController.ts
import { Request, Response } from 'express';
import pool from '../config/db';
import stripe from '../config/stripe';
import { sha256Hex, makeCode, normalizeOtp } from '../utils/security';
import { logAudit } from '../services/audit';
import { sendLetter } from '../services/addressMail';
import { addressFingerprint } from '../utils/address';
import * as marqetaService from '../webhooks/marqetaService';
import { generateMockCardNumber, generateExpiryDate, generateCVV } from '../utils/cardUtils';
import { encrypt, decryptNullable } from '../utils/crypto';
import { buildIdentityValidatedEmail } from '../templates/emails/identityValidatedEmail';
import { sendEmail } from '../utils/notificationUtils'; // ajuste le chemin si besoin

/* =========================
 * MARQETA: Produits de cartes
 * ========================= */
export const listMarqetaCardProducts = async (req: Request, res: Response) => {
  try {
    const cardProducts = await marqetaService.listCardProducts();
    res.json(cardProducts);
  } catch (err: any) {
    console.error('Erreur récupération card products:', err.message);
    res.status(500).json({ error: 'Erreur serveur : card products non récupérés' });
  }
};

/* ============================================================
 * Liste tous les utilisateurs (avec info membre, profil, carte)
 * ============================================================ */
export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const users = await pool.query(`
      SELECT 
        u.id, u.username,
        u.email_enc, u.phone_enc,
        u.role, u.is_verified, 
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
        WHERE user_id = u.id AND category = 'physique'
        ORDER BY created_at DESC
        LIMIT 1
      ) c ON true
      ORDER BY u.created_at DESC
    `);

    res.json(
      users.rows.map(r => ({
        ...r,
        email: decryptNullable(r.email_enc) ?? '',
        phone: decryptNullable(r.phone_enc) ?? '',
      }))
    );
  } catch (err) {
    console.error('Erreur getAllUsers:', err);
    res.status(501).json({ error: 'Erreur serveur.' });
  }
};

/* ======================================================================
 * Détail complet d'un utilisateur (pour AdminUserDetailScreen) — déchiffré
 * ====================================================================== */
export const getUserDetail = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    // 1. Infos utilisateur
    const userRes = await pool.query(
      `
      SELECT 
        u.id, u.username,
        u.email_enc, u.phone_enc,
        u.first_name_enc, u.last_name_enc,
        u.address_enc,
        u.birth_date, u.birth_country, 
        u.id_type, u.id_number, u.id_issue_date, u.id_expiry_date,
        u.role, u.is_verified, u.identity_verified, u.is_blacklisted, u.is_deceased,
        u.city, u.department, u.country, u.zip_code, 
        u.face_url, u.document_url,
        pi.url AS profile_photo
      FROM users u
      LEFT JOIN profile_images pi ON pi.user_id = u.id AND pi.is_current = true
      WHERE u.id = $1
      LIMIT 1
    `,
      [id]
    );

    if (!userRes.rows.length) {
      return res.status(404).json({ error: 'Utilisateur non trouvé.' });
    }

    const row = userRes.rows[0];
    const user = {
      ...row,
      email: decryptNullable(row.email_enc) ?? '',
      phone: decryptNullable(row.phone_enc) ?? '',
      first_name: decryptNullable(row.first_name_enc) ?? '',
      last_name: decryptNullable(row.last_name_enc) ?? '',
      address: decryptNullable(row.address_enc) ?? '',
    };

    // 2. Contacts liés (membres)
    const contactsRes = await pool.query(
      `SELECT contact FROM members WHERE user_id = $1`,
      [id]
    );
    (user as any).contacts = contactsRes.rows.map(r => r.contact);

    // 3. Liste complète des cartes (toujours inclure l’image/design, jamais les données sensibles !)
    const cardsRes = await pool.query(
      `
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
    `,
      [id]
    );
    (user as any).cards = cardsRes.rows;

    // 3bis. Dernière carte physique à imprimer
    const printCardRes = await pool.query(
      `
      SELECT 
        uc.id AS user_card_id,
        uc.type AS custom_type,
        uc.category,
        uc.style_id,
        COALESCE(uc.design_url, ct.image_url) AS final_card_image,
        ct.label AS style_label,
        uc.is_approved
      FROM user_cards uc
      LEFT JOIN card_types ct ON uc.style_id = ct.type
      WHERE uc.user_id = $1
        AND uc.category = 'physique'
        AND uc.is_approved = true
      ORDER BY uc.created_at DESC
      LIMIT 1
    `,
      [id]
    );
    (user as any).card_to_print = printCardRes.rows[0] || null;

    // 4. Audit logs
    const auditRes = await pool.query(
      `SELECT action, created_at, details FROM audit_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`,
      [id]
    );
    (user as any).audit_logs = auditRes.rows;

    res.json(user);
  } catch (err) {
    console.error('❌ Erreur getUserDetail:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

/* ==========================================
 * Activer / désactiver un compte utilisateur
 * ========================================== */
export const setUserVerified = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { is_verified } = req.body;
  try {
    await pool.query('UPDATE users SET is_verified = $1 WHERE id = $2', [is_verified, id]);
    res.json({ message: `Utilisateur ${is_verified ? 'activé' : 'désactivé'} avec succès.` });
  } catch (err) {
    res.status(502).json({ error: 'Erreur serveur.' });
  }
};

/* ===========================
 * Liste noire / Décès
 * =========================== */
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

/* ==================
 * Valider identité
 * ================== */
export const validateIdentity = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    console.log("🔍 Démarrage de la validation d'identité pour l'utilisateur ID:", id);

    // 1) Utilisateur
    const userRes = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
    if (userRes.rowCount === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé.' });
    }
    const user = userRes.rows[0];

    // 2) Déjà validé ?
    if (user.identity_verified) {
      return res.status(400).json({ error: "L'identité a déjà été validée." });
    }

    // 3) Carte virtuelle déjà existante ?
    const cardCheck = await pool.query(
      `SELECT 1 FROM cards WHERE user_id = $1 AND type = 'virtual'`,
      [id]
    );
    if (cardCheck.rowCount && cardCheck.rowCount > 0) {
      return res.status(400).json({ error: "Carte virtuelle déjà existante pour cet utilisateur." });
    }

    // 4) Mise à jour de l’état local
    await pool.query(
      `UPDATE users SET is_verified = true, identity_verified = true, verified_at = NOW() WHERE id = $1`,
      [id]
    );

    // 5) Cardholder Marqeta
    const cardholderToken = await marqetaService.createMarqetaCardholder(id);

    // 6) Carte virtuelle Marqeta
    const card = await marqetaService.createVirtualCard(cardholderToken);
    if (!card || !card.token) {
      return res.status(500).json({ error: 'Échec de création de carte virtuelle.' });
    }

    // 7) Données d’affichage (mock)
    const cardNumber  = generateMockCardNumber();
    const expiryDate  = generateExpiryDate();
    const cvv         = generateCVV();

    // 8) Persist carte en DB
    await pool.query(
      `
      INSERT INTO cards (
        id, user_id, marqeta_card_token, marqeta_cardholder_token,
        type, status, last4, created_at,
        card_number, expiry_date, encrypted_data
      ) VALUES (
        gen_random_uuid(), $1, $2, $3,
        $4, $5, $6, NOW(),
        $7, $8, $9
      )
      `,
      [
        id,
        card.token,
        cardholderToken,
        'virtual',
        card.state,
        card.last_four_digits,
        cardNumber,
        expiryDate,
        JSON.stringify({ cvv }) // (démo)
      ]
    );

    // 9) 📧 EMAIL UNIQUE “Identité validée”
    try {
      const emailPlain =
        decryptNullable(user.email_enc) ??
        user.email ??
        null;

      const firstName =
        decryptNullable(user.first_name_enc) ??
        user.first_name ??
        '';

      const lastName =
        decryptNullable(user.last_name_enc) ??
        user.last_name ??
        '';

      if (emailPlain) {
        const { subject, text, html } = buildIdentityValidatedEmail({
          firstName,
          lastName,
          loginUrl: process.env.APP_LOGIN_URL || 'https://app.cash-hay.com/login',
          reward: Number(process.env.WELCOME_REWARD_HTG ?? '25'),
        });
        await sendEmail({ to: emailPlain, subject, text, html });
      } else {
        console.warn(`⚠️ Aucun email en clair disponible pour l’utilisateur ${id}, email non envoyé.`);
      }
    } catch (mailErr) {
      // on ne bloque pas la réussite métier si l’email échoue
      console.error('⚠️ Envoi email identité validée échoué :', mailErr);
    }

    // 10) Réponse API
    return res.status(200).json({
      success: true,
      message: 'Identité validée et carte virtuelle créée avec succès.',
      card: {
        token:  card.token,
        last4:  card.last_four_digits,
        status: card.state,
        cardNumber,
        expiryDate,
        cvv,
      },
    });
  } catch (err: any) {
    console.error('❌ Erreur dans validateIdentity:', err.response?.data || err.message);
    return res.status(500).json({
      error: "Erreur lors de la validation de l'identité ou de la création de la carte.",
      detail: err.response?.data || err.message,
    });
  }
};

/* =========================================
 * Réactiver la soumission d'identité (admin)
 * ========================================= */
export const reactivateIdentityRequest = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE users SET identity_request_enabled = true WHERE id = $1 RETURNING id, username, identity_request_enabled`,
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé.' });
    }
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, details)
       VALUES ($1, $2, $3)`,
      [id, 'reactivate_identity_request', 'Réactivation manuelle de la soumission d’identité']
    );
    res.json({ message: "Soumission d'identité réactivée.", user: result.rows[0] });
  } catch (err) {
    res.status(505).json({ error: 'Erreur lors de la réactivation.' });
  }
};

/* ========================================
 * Débloquer un utilisateur bloqué pour OTP
 * ======================================== */
export const unblockUserOTP = async (req: Request, res: Response) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'ID utilisateur requis.' });

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

/* ============================================================
 * Récupération des cartes physiques à imprimer (déchiffrage PII)
 * ============================================================ */
export const getAllPhysicalCards = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `
      SELECT 
        uc.id, uc.type, uc.category, uc.design_url, uc.is_printed,
        uc.created_at, uc.is_approved, uc.approved_at,
        u.id as user_id,
        u.first_name_enc, u.last_name_enc, u.email_enc,
        ct.label as card_style, ct.image_url as style_image
      FROM user_cards uc
      JOIN users u ON uc.user_id = u.id
      LEFT JOIN card_types ct ON uc.style_id = ct.type
      WHERE uc.category = 'physique'
      ORDER BY uc.created_at DESC
      `
    );

    res.status(200).json(
      result.rows.map(r => ({
        ...r,
        first_name: decryptNullable(r.first_name_enc) ?? '',
        last_name: decryptNullable(r.last_name_enc) ?? '',
        email: decryptNullable(r.email_enc) ?? '',
      })
      )
    );
  } catch (err) {
    console.error('Erreur récupération cartes physiques:', err);
    res.status(500).json({
      error: 'Erreur serveur',
      details: err instanceof Error ? err.message : undefined,
    });
  }
};

/* =======================================================
 * Récupère toutes les cartes personnalisées d’un utilisateur
 * ======================================================= */
export const getUserCustomCards = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT 
        uc.id,
        uc.type,
        uc.category,
        uc.style_id,
        uc.price AS custom_price,
        uc.design_url,
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
        c.created_at AS requested_at,
        c.type AS card_type,
        c.account_type
      FROM user_cards uc
      LEFT JOIN card_types ct ON uc.style_id = ct.type
      LEFT JOIN cards c ON uc.card_id = c.id
      WHERE uc.user_id = $1
        AND uc.design_url IS NOT NULL
      ORDER BY uc.created_at DESC
    `,
      [id]
    );

    res.status(200).json({ cards: result.rows });
  } catch (err) {
    console.error('❌ Erreur récupération cartes personnalisées:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

/* ============================
 * Autoriser une nouvelle demande
 * ============================ */
export const allowCardRequest = async (req: Request, res: Response) => {
  const userId = req.params.id;

  try {
    await pool.query(`UPDATE users SET card_request_allowed = true WHERE id = $1`, [userId]);
    res.json({ message: 'L’utilisateur peut à nouveau demander une carte.' });
  } catch (err) {
    console.error('❌ Erreur admin autorisation:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

/* ==========================================
 * Approuver une carte physique personnalisée
 * ========================================== */
export const approveCustomCard = async (req: Request, res: Response) => {
  const { cardId } = req.params;
  const adminId = req.user?.id;

  try {
    const result = await pool.query(
      `
      UPDATE user_cards
      SET is_approved = true, approved_by = $1, approved_at = NOW()
      WHERE id = $2 AND category = 'physique'
      RETURNING *
      `,
      [adminId, cardId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Carte non trouvée ou déjà approuvée.' });
    }

    return res.json({ message: 'Carte personnalisée approuvée avec succès.' });
  } catch (err) {
    console.error('❌ Erreur approbation carte personnalisée :', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};

/* =========================================
 * Toutes les cartes d’un utilisateur (admin)
 * ========================================= */
export const getUserAllCards = async (req: Request, res: Response) => {
  const { id } = req.params; // user_id

  try {
    const result = await pool.query(
      `
      SELECT 
        uc.id AS user_card_id,
        uc.type AS custom_type,
        uc.category,
        uc.design_url,
        uc.is_printed,
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
      ORDER BY uc.created_at DESC
      `,
      [id]
    );

    res.json({ cards: result.rows });
  } catch (err) {
    console.error('❌ Erreur récupération toutes les cartes:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

/* ============================
 * Marquer une carte comme imprimée
 * ============================ */
export const markCardAsPrinted = async (req: Request, res: Response) => {
  const { cardId } = req.params;
  const adminId = req.user?.id;

  try {
    const result = await pool.query(
      `
      UPDATE user_cards 
      SET is_printed = true 
      WHERE id = $1 
      RETURNING *, user_id
      `,
      [cardId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Carte non trouvée.' });
    }

    await pool.query(
      `
      INSERT INTO audit_logs (user_id, action, details) 
      VALUES ($1, 'mark_card_printed', $2)
      `,
      [result.rows[0].user_id, `Carte ${cardId} marquée comme imprimée par admin ${adminId}`]
    );

    res.json({ message: 'Carte marquée comme imprimée.', card: result.rows[0] });
  } catch (err) {
    console.error('❌ Erreur markCardAsPrinted:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

/* ============================
 * Annuler une carte (Stripe)
 * ============================ */
export const adminCancelCard = async (req: Request, res: Response) => {
  const adminId = req.user?.id;
  const { cardId } = req.body;

  const { rows } = await pool.query(
    `SELECT * FROM cards WHERE id = $1 AND status = 'pending_cancel'`,
    [cardId]
  );
  if (rows.length === 0) {
    return res.status(404).json({ error: "Carte non trouvée ou pas en attente d'annulation." });
  }
  const card = rows[0];

  try {
    await stripe.issuing.cards.update(card.stripe_card_id, { status: 'canceled' });
  } catch (err) {
    console.error('Erreur Stripe (cancel card):', err);
    return res.status(500).json({ error: 'Erreur Stripe lors de l’annulation de la carte.' });
  }

  await pool.query(
    `
    UPDATE cards
    SET status = 'cancelled', is_locked = true, cancelled_at = NOW(), cancelled_by = $1, updated_at = NOW()
    WHERE id = $2
    `,
    [adminId, cardId]
  );

  await pool.query(
    `
    INSERT INTO audit_logs (user_id, action, details, created_at) 
    VALUES ($1, $2, $3, NOW())
    `,
    [adminId, 'admin_cancel_card', `Carte physique ID ${cardId} annulée sur Stripe`]
  );

  return res.json({ message: 'Carte annulée définitivement sur Stripe et en base.' });
};

/* ===========================================
 * Activer une carte physique (Marqeta handler)
 * =========================================== */
export const activatePhysicalCardHandler = async (req: Request, res: Response) => {
  const cardToken = req.params.id;
  const { pin } = req.body;

  if (!pin || pin.length !== 4) {
    return res.status(400).json({ error: 'PIN invalide (4 chiffres requis)' });
  }

  try {
    const result = await marqetaService.activatePhysicalCard(cardToken, pin);
    res.status(200).json({ message: 'Carte activée avec succès', result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getCardShippingInfoHandler = async (req: Request, res: Response) => {
  const cardToken = req.params.id;

  try {
    const shippingInfo = await marqetaService.getCardShippingInfo(cardToken);
    res.status(200).json(shippingInfo);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getCardProducts = async (req: Request, res: Response) => {
  try {
    const products = await marqetaService.listCardProducts();
    res.json({ success: true, products });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ===========================
 * Vérifier code postal courrier
 * =========================== */
export async function verifyAddressMail(req: Request, res: Response) {
  const userId = (req as any).user?.id;
  const { code } = req.body;

  if (!userId) return res.status(401).json({ error: 'unauthorized' });
  if (!code) return res.status(400).json({ error: 'code_required' });

  const { rows } = await pool.query(
    `
    SELECT id, code_hash, attempt_count, max_attempts, expires_at, status
      FROM address_mail_verifications
     WHERE user_id=$1
       AND status IN ('mailed','delivered')
       AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1
    `,
    [userId]
  );

  if (rows.length === 0) {
    return res.status(400).json({ error: 'no_active_request' });
  }

  const v = rows[0];

  if (v.attempt_count >= v.max_attempts) {
    return res.status(429).json({ error: 'too_many_attempts' });
  }

  const ok = sha256Hex(normalizeOtp(String(code))) === String(v.code_hash);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (!ok) {
      await client.query(
        `
        UPDATE address_mail_verifications
           SET attempt_count = attempt_count + 1, updated_at = now()
         WHERE id = $1
        `,
        [v.id]
      );
      await client.query('COMMIT');
      return res.status(400).json({ error: 'invalid_code' });
    }

    await client.query(
      `
      UPDATE address_mail_verifications
         SET status='verified', verified_at=now(), updated_at=now()
       WHERE id=$1
      `,
      [v.id]
    );

    await client.query(
      `
      UPDATE users
         SET address_verified=true, address_verified_at=now()
       WHERE id=$1
      `,
      [userId]
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  try {
    await logAudit(userId, 'address_mail_verified', req);
  } catch {}
  return res.json({ status: 'verified' });
}

/* ===========================
 * Démarrer l’envoi courrier
 * =========================== */
export async function startAddressMail(req: Request, res: Response) {
  const userId = (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: 'unauthorized' });

  // ---- lecture + normalisation ----
  const body = (req.body || {}) as {
    address_line1?: string | null;
    address_line2?: string | null;
    city?: string | null;
    department?: string | null;
    postal_code?: string | null;
    country?: string | null;
  };

  const addressLine1: string = (body.address_line1 ?? '').trim();
  const cityNorm: string = (body.city ?? '').trim();
  const countryNorm: string = (body.country ?? '').trim().toUpperCase();

  // optionnels pour provider: string | undefined
  const addressLine2Undef: string | undefined = body.address_line2?.trim() || undefined;
  const departmentUndef: string | undefined = body.department?.trim() || undefined;
  const postalCodeUndef: string | undefined = body.postal_code?.trim() || undefined;

  if (!addressLine1 || !cityNorm || !countryNorm) {
    return res.status(400).json({ error: 'invalid_address' });
  }
  if (countryNorm.length < 2 || countryNorm.length > 3) {
    return res.status(400).json({ error: 'invalid_country' });
  }

  // Empreinte normalisée de l’adresse
  const address_fp = addressFingerprint({
    address_line1: addressLine1,
    address_line2: addressLine2Undef ?? null,
    city: cityNorm,
    department: departmentUndef ?? null,
    postal_code: postalCodeUndef ?? null,
    country: countryNorm,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 0) Bloquer si déjà vérifié
    const uRes = await client.query(`SELECT address_verified FROM users WHERE id=$1`, [userId]);
    if (uRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'user_not_found' });
    }
    if (uRes.rows[0].address_verified) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'already_verified' });
    }

    // 1) Expirer les anciennes actives dépassées
    await client.query(
      `
      UPDATE address_mail_verifications
         SET status='expired', updated_at=now()
       WHERE user_id=$1
         AND status IN ('pending','mailed','delivered')
         AND expires_at <= now()
      `,
      [userId]
    );

    // 2) Vérifier s'il reste une active (non échue)
    const active = await client.query(
      `
      SELECT id
        FROM address_mail_verifications
       WHERE user_id=$1
         AND status IN ('pending','mailed','delivered')
       ORDER BY created_at DESC
       LIMIT 1
      `,
      [userId]
    );
    if (active.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'already_active_request' });
    }

    // 3) Générer code & hash
    const code = makeCode(6);
    const code_hash = sha256Hex(normalizeOtp(code));

    // 4) Appel provider
    const { pdfUrl, providerId } = await sendLetter({
      to: {
        address_line1: addressLine1,
        address_line2: addressLine2Undef,
        city: cityNorm,
        department: departmentUndef,
        postal_code: postalCodeUndef,
        country: countryNorm,
      },
      code,
      user: { id: userId },
    });

    // 5) Insert (expire à +90 jours) — avec *_enc + address_fp
    const ins = await client.query(
      `
      INSERT INTO address_mail_verifications (
         user_id,
         address_line1, address_line2, city, department, postal_code, country,
         address_line1_enc, address_line2_enc, city_enc, department_enc, postal_code_enc, country_enc,
         address_fp,
         code_hash, code_length, status, provider, provider_tracking_id, letter_url,
         mailed_at, expires_at, created_at, updated_at,
         attempt_count, max_attempts
       ) VALUES (
         $1,
         $2,$3,$4,$5,$6,$7,
         $8,$9,$10,$11,$12,$13,
         $14,
         $15,$16,'mailed',$17,$18,$19,
         now(), now() + interval '90 days', now(), now(),
         0, 5
       )
       RETURNING id, expires_at
      `,
      [
        userId,
        addressLine1,
        addressLine2Undef ?? null,
        cityNorm,
        departmentUndef ?? null,
        postalCodeUndef ?? null,
        countryNorm,
        encrypt(addressLine1),
        addressLine2Undef ? encrypt(addressLine2Undef) : null,
        encrypt(cityNorm),
        departmentUndef ? encrypt(departmentUndef) : null,
        postalCodeUndef ? encrypt(postalCodeUndef) : null,
        encrypt(countryNorm),
        address_fp,
        code_hash,
        6,
        providerId,
        providerId, // tracking id si identique
        pdfUrl,
      ]
    );

    await client.query('COMMIT');

    // audit best-effort
    try {
      await logAudit(userId, 'address_mail_started', req, { city: cityNorm, country: countryNorm });
    } catch {}

    return res.status(201).json({
      status: 'mailed',
      requestId: ins.rows[0].id,
      expires_at: ins.rows[0].expires_at,
      address_line1: addressLine1,
      address_line2: addressLine2Undef ?? null,
      city: cityNorm,
      department: departmentUndef ?? null,
      postal_code: postalCodeUndef ?? null,
      country: countryNorm,
    });
  } catch (e: any) {
    await client.query('ROLLBACK');
    if (e?.code === '23505') {
      return res.status(409).json({ error: 'already_active_request' });
    }
    console.error('❌ startAddressMail error:', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  } finally {
    client.release();
  }
}

/* ===========================
 * Statut envoi courrier
 * =========================== */
export async function statusAddressMail(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });

    // On prend la DERNIÈRE demande (même si expirée) pour pouvoir la marquer "expired"
    const { rows } = await pool.query(
      `
      SELECT id, status, expires_at, attempt_count, max_attempts,
             address_line1_enc, address_line2_enc, city_enc, department_enc, postal_code_enc, country_enc
        FROM address_mail_verifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1
      `,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'no_active_request' });
    }

    const v = rows[0];
    const isExpired = v.expires_at && new Date(v.expires_at).getTime() <= Date.now();

    // Si expirée et pas déjà finalisée → on met à jour en DB
    if (isExpired && !['expired', 'verified', 'returned', 'canceled'].includes(v.status)) {
      await pool.query(
        `UPDATE address_mail_verifications SET status='expired', updated_at=now() WHERE id=$1`,
        [v.id]
      );
      v.status = 'expired';
    }

    // Si finalisée → 404 pour que le front propose un nouvel envoi
    if (['expired', 'verified', 'returned', 'canceled'].includes(v.status)) {
      return res.status(404).json({ error: 'no_active_request' });
    }

    return res.json({
      requestId: v.id,
      status: v.status as
        | 'pending'
        | 'mailed'
        | 'delivered'
        | 'verified'
        | 'returned'
        | 'expired'
        | 'canceled',
      expires_at: v.expires_at,
      attempt_count: v.attempt_count,
      max_attempts: v.max_attempts,
      address_line1: decryptNullable(v.address_line1_enc) ?? null,
      address_line2: decryptNullable(v.address_line2_enc) ?? null,
      city: decryptNullable(v.city_enc) ?? null,
      department: decryptNullable(v.department_enc) ?? null,
      postal_code: decryptNullable(v.postal_code_enc) ?? null,
      country: decryptNullable(v.country_enc) ?? null,
    });
  } catch (e: any) {
    console.error('statusAddressMail error:', e?.message || e);
    return res.status(500).json({ error: 'server_error' });
  }
}

/* ===========================
 * Pré-init écran courrier
 * =========================== */
export async function initAddressMail(req: Request, res: Response) {
  const userId = (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: 'unauthorized' });

  // 1) Profil
  const uRes = await pool.query(
    `
    SELECT address_verified, address_enc, city, department, zip_code, country
      FROM users
     WHERE id = $1
    `,
    [userId]
  );
  if (uRes.rows.length === 0) return res.status(404).json({ error: 'user_not_found' });

  const u = uRes.rows[0] as {
    address_verified: boolean;
    address_enc: string | null;
    city: string | null;
    department: string | null;
    zip_code: string | null;
    country: string | null;
  };

  // 2) Dernière demande (active ou pas)
  const vRes = await pool.query(
    `
    SELECT id, status, expires_at, attempt_count, max_attempts,
           address_line1_enc, address_line2_enc, city_enc, department_enc, postal_code_enc, country_enc,
           verified_at, created_at
      FROM address_mail_verifications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 1
    `,
    [userId]
  );

  let active = false;
  let current:
    | null
    | {
        requestId: string;
        status: 'pending' | 'mailed' | 'delivered';
        expires_at: string | Date;
        attempt_count: number;
        max_attempts: number;
        address_line1: string | null;
        address_line2: string | null;
        city: string | null;
        department: string | null;
        postal_code: string | null;
        country: string | null;
      } = null;

  if (vRes.rows.length > 0) {
    const v = vRes.rows[0];
    const exp = v.expires_at ? new Date(v.expires_at) : null;

    active =
      (v.status === 'pending' || v.status === 'mailed' || v.status === 'delivered') &&
      !!exp &&
      exp.getTime() > Date.now();

    if (active) {
      current = {
        requestId: v.id,
        status: v.status,
        expires_at: v.expires_at,
        attempt_count: v.attempt_count,
        max_attempts: v.max_attempts,
        address_line1: decryptNullable(v.address_line1_enc) ?? null,
        address_line2: decryptNullable(v.address_line2_enc) ?? null,
        city: decryptNullable(v.city_enc) ?? null,
        department: decryptNullable(v.department_enc) ?? null,
        postal_code: decryptNullable(v.postal_code_enc) ?? null,
        country: decryptNullable(v.country_enc) ?? null,
      };
    }
  }

  // 3) Déjà vérifié ?
  const isVerified = Boolean(u.address_verified) || (vRes.rows[0]?.status === 'verified');

  // 4) Pré-remplissage
  const prefill = current
    ? {
        address_line1: current.address_line1,
        address_line2: current.address_line2,
        city: current.city,
        department: current.department,
        postal_code: current.postal_code,
        country: current.country,
      }
    : {
        address_line1: decryptNullable(u.address_enc) ?? '',
        address_line2: null as string | null,
        city: u.city ?? '',
        department: u.department ?? null,
        postal_code: u.zip_code ?? null,
        country: u.country ?? 'HT',
      };

  return res.json({
    address_verified: isVerified,
    active,
    current, // null si pas d’envoi actif
    prefill,
  });
}
