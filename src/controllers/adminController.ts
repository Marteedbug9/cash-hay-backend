import { Request, Response } from 'express';
import pool from '../config/db';
import stripe from '../config/stripe';
import { createMarqetaCardholder, createVirtualCard,activatePhysicalCard,getCardShippingInfo,listCardProducts } from '../webhooks/marqetaService';
// src/controllers/adminController.ts
import * as marqetaService from '../webhooks/marqetaService';
import { generateMockCardNumber, generateExpiryDate, generateCVV } from '../utils/cardUtils';
const cardNumber = generateMockCardNumber();
const expiryDate = generateExpiryDate();
const cvv = generateCVV();


export const listMarqetaCardProducts = async (req: Request, res: Response) => {
  try {
    const cardProducts = await marqetaService.listCardProducts();
    res.json(cardProducts);
  } catch (err: any) {
    console.error('Erreur récupération card products:', err.message);
    res.status(500).json({ error: 'Erreur serveur : card products non récupérés' });
  }
};


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
        WHERE user_id = u.id AND category = 'physique'
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
    // 1. Infos utilisateur
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

    // 2. Contacts liés (membres)
    const contactsRes = await pool.query(
      `SELECT contact FROM members WHERE user_id = $1`, [id]
    );
    user.contacts = contactsRes.rows.map(row => row.contact);

    // 3. Liste complète des cartes (toujours inclure l’image/design, jamais les données sensibles !)
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


    // 3bis. Dernière carte physique à imprimer (toujours renvoyer le design)
    const printCardRes = await pool.query(`
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
    `, [id]);
    user.card_to_print = printCardRes.rows[0] || null;

    // 4. Audit logs
    const auditRes = await pool.query(
      `SELECT action, created_at, details FROM audit_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`, [id]
    );
    user.audit_logs = auditRes.rows;

    // ✅ Envoi final
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
// ➤ Valider identité
export const validateIdentity = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    console.log("🔍 Démarrage de la validation d'identité pour l'utilisateur ID:", id);

    // 1. Vérifie si l'utilisateur existe
    const userRes = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
    if (userRes.rowCount === 0) {
      console.warn("❌ Utilisateur non trouvé avec l'ID:", id);
      return res.status(404).json({ error: 'Utilisateur non trouvé.' });
    }
    const user = userRes.rows[0];
    console.log("✅ Utilisateur trouvé:", user.username || user.id);

    // 2. Vérifie si l'identité est déjà validée
    if (user.identity_verified) {
      console.warn("⚠️ Identité déjà validée pour:", user.id);
      return res.status(400).json({ error: "L'identité a déjà été validée." });
    }

    // 3. Vérifie si une carte virtuelle existe déjà
    const cardCheck = await pool.query(
      `SELECT * FROM cards WHERE user_id = $1 AND type = 'virtual'`,
      [id]
    );
    if (cardCheck?.rowCount && cardCheck.rowCount > 0) {
      console.warn("⚠️ Carte virtuelle déjà existante pour l'utilisateur:", id);
      return res.status(400).json({ error: "Carte virtuelle déjà existante pour cet utilisateur." });
    }

    // 4. Met à jour la vérification locale
    await pool.query(`
      UPDATE users 
      SET is_verified = true, identity_verified = true, verified_at = NOW()
      WHERE id = $1
    `, [id]);
    console.log("✅ Identité mise à jour localement.");

    // 5. Crée le cardholder chez Marqeta
    const cardholderToken = await createMarqetaCardholder(id);
    console.log("🟢 Cardholder créé avec Marqeta:", cardholderToken);

    // 6. Crée la carte virtuelle Marqeta
    const card = await createVirtualCard(cardholderToken);
    console.log("🟢 Réponse de création de carte virtuelle Marqeta:", card);

    if (!card || !card.token) {
      console.error("❌ Erreur: Carte non créée correctement.");
      return res.status(500).json({
        error: "Échec de création de carte virtuelle.",
        detail: card
      });
    }

    // 🧠 7. Génère les infos fictives
    const cardNumber = generateMockCardNumber();
    const expiryDate = generateExpiryDate();
    const cvv = generateCVV();

    // 💾 8. Enregistre dans la DB
    await pool.query(`
      INSERT INTO cards (
        id, user_id, marqeta_card_token, marqeta_cardholder_token,
        type, status, last4, created_at,
        card_number, expiry_date, encrypted_data
      ) VALUES (
        gen_random_uuid(), $1, $2, $3,
        $4, $5, $6, NOW(),
        $7, $8, $9
      )
    `, [
      id,
      card.token,
      cardholderToken,
      'virtual',
      card.state,
      card.last_four_digits,
      cardNumber,
      expiryDate,
      JSON.stringify({ cvv }), // CVC stocké de manière "pseudo-sécurisée"
    ]);
    console.log("✅ Carte virtuelle enregistrée dans la base de données.");

    // ✅ 9. Succès
    return res.status(200).json({
      success: true,
      message: "Identité validée et carte virtuelle créée avec succès.",
      card: {
        token: card.token,
        last4: card.last_four_digits,
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
      detail: err.response?.data || err.message
    });
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

// ➤ Modifiez getAllPhysicalCards pour mieux gérer les erreurs :
export const getAllPhysicalCards = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT 
        uc.id, uc.type, uc.category, uc.design_url, uc.is_printed,
        uc.created_at, uc.is_approved, uc.approved_at,
        u.id as user_id, u.first_name, u.last_name, u.email,
        ct.label as card_style, ct.image_url as style_image
       FROM user_cards uc
       JOIN users u ON uc.user_id = u.id
       LEFT JOIN card_types ct ON uc.style_id = ct.type
       WHERE uc.category = 'physique'
       ORDER BY uc.created_at DESC`
    );
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Erreur récupération cartes physiques:', err);
    res.status(500).json({ 
      error: 'Erreur serveur',
      details: err instanceof Error ? err.message : undefined
    });
  }
};

// ➤ Récupère toutes les cartes personnalisées d’un utilisateur
export const getUserCustomCards = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const result = await pool.query(`
      SELECT 
        uc.id,
        uc.type,
        uc.category,             -- <-- AJOUTÉ ici
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
    `, [id]);

    res.status(200).json({ cards: result.rows });
  } catch (err) {
    console.error('❌ Erreur récupération cartes personnalisées:', err);
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
       WHERE id = $2 AND category = 'physique'
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
         uc.category,                             -- Ajoute ici !
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
       ORDER BY uc.created_at DESC`,
      [id]
    );

    res.json({ cards: result.rows });
  } catch (err) {
    console.error('❌ Erreur récupération toutes les cartes:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};



export const markCardAsPrinted = async (req: Request, res: Response) => {
  const { cardId } = req.params;
  const adminId = req.user?.id;

  try {
    const result = await pool.query(
      `UPDATE user_cards 
       SET is_printed = true 
       WHERE id = $1 
       RETURNING *, user_id`,
      [cardId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Carte non trouvée." });
    }

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, details) 
       VALUES ($1, 'mark_card_printed', $2)`,
      [result.rows[0].user_id, `Carte ${cardId} marquée comme imprimée par admin ${adminId}`]
    );

    res.json({ message: 'Carte marquée comme imprimée.', card: result.rows[0] });
  } catch (err) {
    console.error('❌ Erreur markCardAsPrinted:', err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};


export const adminCancelCard = async (req: Request, res: Response) => {
  const adminId = req.user?.id;
  const { cardId } = req.body; // ou req.params selon routing

  // 1. Vérifier le statut "pending_cancel"
  const { rows } = await pool.query(
    `SELECT * FROM cards WHERE id = $1 AND status = 'pending_cancel'`,
    [cardId]
  );
  if (rows.length === 0) {
    return res.status(404).json({ error: "Carte non trouvée ou pas en attente d'annulation." });
  }
  const card = rows[0];

  // 2. Annule sur Stripe (status="canceled" = destruction définitive)
  try {
    await stripe.issuing.cards.update(card.stripe_card_id, { status: "canceled" });
  } catch (err) {
    console.error('Erreur Stripe (cancel card):', err);
    return res.status(500).json({ error: "Erreur Stripe lors de l’annulation de la carte." });
  }

  // 3. Mets à jour la base locale
  await pool.query(
    `UPDATE cards SET status = 'cancelled', is_locked = true, cancelled_at = NOW(), cancelled_by = $1, updated_at = NOW() WHERE id = $2`,
    [adminId, cardId]
  );

  // 4. Log admin
  await pool.query(
    `INSERT INTO audit_logs (user_id, action, details, created_at) 
     VALUES ($1, $2, $3, NOW())`,
    [adminId, 'admin_cancel_card', `Carte physique ID ${cardId} annulée sur Stripe`]
  );

  return res.json({ message: "Carte annulée définitivement sur Stripe et en base." });
};

export const activatePhysicalCardHandler = async (req: Request, res: Response) => {
  const cardToken = req.params.id;
  const { pin } = req.body;

  if (!pin || pin.length !== 4) {
    return res.status(400).json({ error: 'PIN invalide (4 chiffres requis)' });
  }

  try {
    const result = await activatePhysicalCard(cardToken, pin);
    res.status(200).json({ message: 'Carte activée avec succès', result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getCardShippingInfoHandler = async (req: Request, res: Response) => {
  const cardToken = req.params.id;

  try {
    const shippingInfo = await getCardShippingInfo(cardToken);
    res.status(200).json(shippingInfo);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

// Récupère les produits de carte Marqeta
export const getCardProducts = async (req: Request, res: Response) => {
  try {
    const products = await listCardProducts();
    res.json({ success: true, products });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};
