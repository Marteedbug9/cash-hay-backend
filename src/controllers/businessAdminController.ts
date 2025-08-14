// src/controllers/businessAdminController.ts
import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import db from '../config/db';
import { sendEmail /*, sendSMS, sendPushNotification*/ } from '../utils/notificationUtils';
import {
  encrypt,
  blindIndexEmail,
  blindIndexPhone,
  decryptNullable,
} from '../utils/crypto';

// ------------------------
// Helpers
// ------------------------
function generateTempPassword(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@$#';
  let pass = '';
  for (let i = 0; i < length; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length));
  return pass;
}

const maskEmail = (email?: string | null) => {
  if (!email) return '';
  const m = email.match(/^(.{2})(.*)(@.*)$/);
  if (!m) return email;
  return `${m[1]}***${m[3]}`;
};

const maskPhone = (p?: string | null) => {
  if (!p) return '';
  const digits = p.replace(/[^\d+]/g, '');
  if (digits.length <= 4) return digits;
  return `${digits.slice(0, 3)}***${digits.slice(-2)}`;
};

// ------------------------
// GET /admin/business-accounts/pending
// ------------------------
export const getPendingBusinessAccounts = async (req: Request, res: Response) => {
  try {
    const { rows } = await db.query(
      `SELECT id, company_name, business_type, status, created_at, members_count
         FROM business_account_requests
        WHERE status = 'pending'
        ORDER BY created_at DESC`
    );
    return res.json({ accounts: rows });
  } catch (err) {
    console.error('❌ getPendingBusinessAccounts:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ------------------------
// GET /admin/business-accounts/:id
// ------------------------
export const getBusinessAccountById = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const rq = await db.query(
      `SELECT
         id,
         user_id,
         company_name,
         legal_status,
         business_type,
         tax_id_enc,
         contact_email_enc,
         contact_phone_enc,
         reason,
         members_count,
         status,
         created_at,
         updated_at
       FROM business_account_requests
       WHERE id = $1
       LIMIT 1`,
      [id]
    );

    if (rq.rowCount === 0) {
      return res.status(404).json({ error: 'Demande introuvable' });
    }

    const r = rq.rows[0];
    const contact_email = decryptNullable(r.contact_email_enc);
    const contact_phone = decryptNullable(r.contact_phone_enc);
    const tax_id = decryptNullable(r.tax_id_enc);

    const docs = await db.query(
      `SELECT id, filename, file_url, created_at
         FROM business_account_documents
        WHERE request_id = $1
        ORDER BY created_at DESC`,
      [id]
    );

    const members = await db.query(
      `SELECT id, email, invite_token, is_verified, submitted_at
         FROM business_account_members
        WHERE request_id = $1
        ORDER BY created_at ASC`,
      [id]
    );

    return res.json({
      request: {
        ...r,
        contact_email,
        contact_phone,
        tax_id,
        contact_email_masked: maskEmail(contact_email),
        contact_phone_masked: maskPhone(contact_phone),
      },
      documents: docs.rows,
      members: members.rows,
    });
  } catch (err) {
    console.error('❌ getBusinessAccountById:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ------------------------
// POST /admin/business-accounts/approve
// ------------------------
export const approveBusinessAccount = async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const { requestId } = req.body;
    if (!requestId) return res.status(400).json({ error: 'requestId requis' });

    await client.query('BEGIN');

    // 1) Récupération de la demande
    const rq = await client.query(
      `SELECT id, company_name, contact_email_enc
         FROM business_account_requests
        WHERE id = $1
        FOR UPDATE`,
      [requestId]
    );
    if (rq.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Demande introuvable' });
    }
    const company_name: string = rq.rows[0].company_name;
    const contact_email = decryptNullable(rq.rows[0].contact_email_enc);

    // 2) Passage à "approved"
    await client.query(
      `UPDATE business_account_requests
          SET status='approved', updated_at=NOW()
        WHERE id=$1`,
      [requestId]
    );

    // 3) Création / reset du business_user pour le contact principal (s’il a un email)
    if (contact_email) {
      const tempPassword = generateTempPassword();
      const hash = await bcrypt.hash(tempPassword, 10);

      const exists = await client.query(
        `SELECT id FROM business_user WHERE email = $1`,
        [contact_email]
      );

      if (exists.rowCount === 0) {
        await client.query(
          `INSERT INTO business_user (email, password_hash, must_change_password, business_account_request_id, created_at, updated_at)
           VALUES ($1, $2, TRUE, $3, NOW(), NOW())`,
          [contact_email, hash, requestId]
        );
      } else {
        await client.query(
          `UPDATE business_user
              SET password_hash=$1, must_change_password=TRUE, updated_at=NOW()
            WHERE email=$2`,
          [hash, contact_email]
        );
      }

      // Email de bienvenue (best-effort)
      sendEmail({
        to: contact_email,
        subject: 'Accès Business Cash Hay',
        text:
          `Bonjour,\n\nVotre business "${company_name}" est validé !\n` +
          `Mot de passe temporaire : ${tempPassword}\n` +
          `Connexion : https://cash-hay.com/business-login\n` +
          `Merci de changer votre mot de passe à la première connexion.`,
      }).catch((e) => console.error('⚠️ email contact principal:', e));
    }

    // 4) Faire pareil pour chaque membre
    const members = await client.query(
      `SELECT email FROM business_account_members WHERE request_id = $1`,
      [requestId]
    );

    for (const m of members.rows as Array<{ email: string }>) {
      const email = (m.email || '').trim().toLowerCase();
      if (!email) continue;

      const tempPwd = generateTempPassword();
      const pwdHash = await bcrypt.hash(tempPwd, 10);

      const exists = await client.query(`SELECT id FROM business_user WHERE email = $1`, [email]);
      if (exists.rowCount === 0) {
        await client.query(
          `INSERT INTO business_user (email, password_hash, must_change_password, business_account_request_id, created_at, updated_at)
           VALUES ($1, $2, TRUE, $3, NOW(), NOW())`,
          [email, pwdHash, requestId]
        );
      } else {
        await client.query(
          `UPDATE business_user
              SET password_hash=$1, must_change_password=TRUE, updated_at=NOW()
            WHERE email=$2`,
          [pwdHash, email]
        );
      }

      // Email au membre (best-effort)
      sendEmail({
        to: email,
        subject: 'Accès Business Cash Hay',
        text:
          `Bonjour,\n\nVotre accès au business "${company_name}" est validé !\n` +
          `Mot de passe temporaire : ${tempPwd}\n` +
          `Connexion : https://cash-hay.com/business-login\n` +
          `Merci de changer votre mot de passe à la première connexion.`,
      }).catch((e) => console.error('⚠️ email membre:', e));
    }

    await client.query('COMMIT');
    return res.json({ success: true, message: 'Business approuvé, accès envoyés.' });
  } catch (err) {
    try {
      await db.query('ROLLBACK');
    } catch {}
    console.error('❌ approveBusinessAccount:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
};

// ------------------------
// POST /admin/business-accounts/reject
// ------------------------
export const rejectBusinessAccount = async (req: Request, res: Response) => {
  const { requestId, reason } = req.body || {};
  if (!requestId) return res.status(400).json({ error: 'requestId requis' });

  try {
    // Si ta table a une colonne rejection_reason, on la renseigne, sinon on ne met que status
    try {
      await db.query(
        `UPDATE business_account_requests
            SET status='rejected', updated_at=NOW(), rejection_reason=$2
          WHERE id=$1`,
        [requestId, reason || null]
      );
    } catch {
      await db.query(
        `UPDATE business_account_requests
            SET status='rejected', updated_at=NOW()
          WHERE id=$1`,
        [requestId]
      );
    }

    return res.json({ success: true, message: 'Demande rejetée.' });
  } catch (err) {
    console.error('❌ rejectBusinessAccount:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ------------------------
// PUT /admin/business-accounts/:id/contact
// ------------------------
export const updateBusinessAccountContact = async (req: Request, res: Response) => {
  const { id } = req.params;
  const body = (req.body || {}) as {
    contact_email?: string | null;
    contact_phone?: string | null;
    tax_id?: string | null;
  };

  try {
    // Normalisation & validation
    const emailRaw = body.contact_email?.trim().toLowerCase() || null;
    const phoneRaw = body.contact_phone?.trim() || null;
    const taxRaw = body.tax_id?.trim() || null;

    const phoneNorm = phoneRaw ? phoneRaw.replace(/[^\d+]/g, '') : null;

    if (emailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
      return res.status(400).json({ error: 'contact_email invalide' });
    }
    if (phoneNorm && !/[\d+]{6,}/.test(phoneNorm)) {
      return res.status(400).json({ error: 'contact_phone invalide' });
    }

    // Chiffre + blind index
    const contact_email_enc = emailRaw ? encrypt(emailRaw) : null;
    const contact_email_bidx = emailRaw ? blindIndexEmail(emailRaw) : null;

    const contact_phone_enc = phoneNorm ? encrypt(phoneNorm) : null;
    const contact_phone_bidx = phoneNorm ? blindIndexPhone(phoneNorm) : null;

    const tax_id_enc = taxRaw ? encrypt(taxRaw) : null;

    const upd = await db.query(
      `UPDATE business_account_requests
          SET contact_email_enc=$2,
              contact_email_bidx=$3,
              contact_phone_enc=$4,
              contact_phone_bidx=$5,
              tax_id_enc=$6,
              updated_at=NOW()
        WHERE id=$1
        RETURNING id, company_name, business_type, status,
                  contact_email_enc, contact_phone_enc, tax_id_enc`,
      [id, contact_email_enc, contact_email_bidx, contact_phone_enc, contact_phone_bidx, tax_id_enc]
    );

    if (upd.rowCount === 0) {
      return res.status(404).json({ error: 'Demande introuvable' });
    }

    const row = upd.rows[0];
    const outEmail = decryptNullable(row.contact_email_enc);
    const outPhone = decryptNullable(row.contact_phone_enc);
    const outTax = decryptNullable(row.tax_id_enc);

    return res.json({
      success: true,
      request: {
        id: row.id,
        company_name: row.company_name,
        business_type: row.business_type,
        status: row.status,
        contact_email: outEmail,
        contact_email_masked: maskEmail(outEmail),
        contact_phone: outPhone,
        contact_phone_masked: maskPhone(outPhone),
        tax_id: outTax,
      },
    });
  } catch (err) {
    console.error('❌ updateBusinessAccountContact:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ------------------------
// DELETE /admin/business-accounts/:id
// ------------------------
export const deleteBusinessAccount = async (req: Request, res: Response) => {
  const { id } = req.params;
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // On supprime d’abord les dépendances
    await client.query(`DELETE FROM business_account_documents WHERE request_id=$1`, [id]);
    await client.query(`DELETE FROM business_account_members   WHERE request_id=$1`, [id]);

    // Puis la demande
    const del = await client.query(
      `DELETE FROM business_account_requests WHERE id=$1`,
      [id]
    );

    await client.query('COMMIT');

    if (del.rowCount === 0) {
      return res.status(404).json({ error: 'Demande introuvable' });
    }
    return res.json({ success: true, message: 'Demande supprimée.' });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('❌ deleteBusinessAccount:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
};
