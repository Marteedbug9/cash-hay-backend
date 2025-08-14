// src/controllers/businessAccountController.ts
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/db';
import cloudinary from '../config/cloudinary';
import streamifier from 'streamifier';
import {
  encrypt,
  decryptNullable,
  blindIndexEmail,
  blindIndexPhone,
} from '../utils/crypto';

/* --------------------------------- Helpers -------------------------------- */

const generateToken = () => uuidv4();

function normalizeEmail(s?: string | null): string {
  return (s ?? '').trim().toLowerCase();
}
function normalizePhone(s?: string | null): string {
  return (s ?? '').trim();
}
function normalizeString(s?: string | null): string {
  return (s ?? '').trim();
}

/** Upload d’un Buffer vers Cloudinary (memoryStorage) */
function uploadBufferToCloudinary(fileBuffer: Buffer, folder: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'auto' },
      (error: any, result: any) => {
        if (error || !result) return reject(error);
        resolve(result.secure_url);
      }
    );
    streamifier.createReadStream(fileBuffer).pipe(stream);
  });
}

/** Récupère un tableau de fichiers depuis req.files, que ce soit .array() ou .fields() */
function getFilesArray(req: Request, fieldName = 'documents'): Express.Multer.File[] {
  const f = req.files as
    | Express.Multer.File[]
    | Record<string, Express.Multer.File[]>
    | undefined;

  if (!f) return [];
  if (Array.isArray(f)) return f;
  if (Array.isArray(f[fieldName])) return f[fieldName]!;
  return [];
}

/* -------------------------- Contrôleurs: Public side ----------------------- */

/**
 * POST /api/business/requests
 * Body:
 *  - company_name, legal_status, business_type (requis)
 *  - tax_id?, contact_email?, contact_phone?, reason?, members_count?
 *  - members_emails? (string CSV ou string[], ex: ["a@b.com","c@d.com"])
 * Files:
 *  - .array('documents') OU .fields([{name:'documents'}]) via multer.memoryStorage()
 */
export const createBusinessAccountRequest = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Utilisateur non authentifié.' });

    const {
      company_name,
      legal_status,
      business_type,
      tax_id,
      contact_email,
      contact_phone,
      reason,
      members_count,
      members_emails,
    } = (req.body ?? {}) as {
      company_name?: string;
      legal_status?: string;
      business_type?: string;
      tax_id?: string | null;
      contact_email?: string | null;
      contact_phone?: string | null;
      reason?: string | null;
      members_count?: number | string | null;
      members_emails?: string[] | string | null;
    };

    // Validations minimales
    if (!company_name || !legal_status || !business_type) {
      return res
        .status(400)
        .json({ error: 'company_name, legal_status et business_type sont requis.' });
    }

    const contactEmailNorm = normalizeEmail(contact_email);
    const contactPhoneNorm = normalizePhone(contact_phone);
    const taxIdNorm        = normalizeString(tax_id);

    // Chiffre + blind-index
    const contact_email_enc  = contactEmailNorm ? encrypt(contactEmailNorm) : null;
    const contact_email_bidx = contactEmailNorm ? blindIndexEmail(contactEmailNorm) : null;
    const contact_phone_enc  = contactPhoneNorm ? encrypt(contactPhoneNorm) : null;
    const contact_phone_bidx = contactPhoneNorm ? blindIndexPhone(contactPhoneNorm) : null;
    const tax_id_enc         = taxIdNorm ? encrypt(taxIdNorm) : null;

    // Fichiers (documents)
    const docFiles = getFilesArray(req, 'documents');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1) Insert de la demande
      const insReq = await client.query(
        `
        INSERT INTO business_account_requests (
          user_id,
          company_name,
          legal_status,
          business_type,
          tax_id_enc,
          contact_email_enc, contact_email_bidx,
          contact_phone_enc, contact_phone_bidx,
          reason,
          members_count,
          created_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW()
        )
        RETURNING id
        `,
        [
          userId,
          company_name.trim(),
          legal_status.trim(),
          business_type.trim(),
          tax_id_enc,
          contact_email_enc,
          contact_email_bidx,
          contact_phone_enc,
          contact_phone_bidx,
          reason ? reason.trim() : null,
          Number.isFinite(+Number(members_count)) ? Number(members_count) : null,
        ]
      );
      const requestId: string = insReq.rows[0].id;

      // 2) Invitations membres (optionnel)
      let emails: string[] = [];
      if (Array.isArray(members_emails)) {
        emails = (members_emails as string[])
          .map(e => normalizeEmail(e))
          .filter(Boolean);
      } else if (typeof members_emails === 'string') {
        emails = members_emails
          .split(/[,\s]+/)
          .map(e => normalizeEmail(e))
          .filter(Boolean);
      }

      for (const email of emails) {
        const token = generateToken();
        await client.query(
          `INSERT INTO business_account_members (request_id, email, invite_token, created_at)
           VALUES ($1, $2, $3, NOW())`,
          [requestId, email, token]
        );
        // TODO: sendEmail réel (HTML) si besoin
        // console.log(`Invitation envoyée à ${email}: https://cash-hay.com/verify-business-member/${token}`);
      }

      // 3) Upload des documents sur Cloudinary et enregistrement des URLs
      for (const file of docFiles) {
        const url = await uploadBufferToCloudinary(
          file.buffer,
          'cash-hay/business_requests/docs'
        );
        await client.query(
          `INSERT INTO business_account_documents (request_id, filename, file_url, created_at)
           VALUES ($1, $2, $3, NOW())`,
          [requestId, file.originalname || 'document', url]
        );
      }

      await client.query('COMMIT');
      return res
        .status(201)
        .json({ message: 'Demande business enregistrée et invitations envoyées !', requestId });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('❌ createBusinessAccountRequest error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

/**
 * POST /api/business/verify-member
 * Body: { token, firstName, lastName, docType }
 * Files (fields): face (1), document (1)
 */
export const verifyBusinessMemberIdentity = async (req: Request, res: Response) => {
  try {
    const { token, firstName, lastName, docType } = (req.body ?? {}) as {
      token?: string;
      firstName?: string;
      lastName?: string;
      docType?: string;
    };

    // Attendu: req.files via multer.fields([{name:'face'},{name:'document'}])
    const filesBag = req.files as Record<string, Express.Multer.File[]> | undefined;
    const faceFile = filesBag?.face?.[0];
    const documentFile = filesBag?.document?.[0];

    if (!token || !firstName || !lastName || !docType || !faceFile || !documentFile) {
      return res.status(400).json({ error: 'Champs requis manquants.' });
    }

    // 1) Valide le membre par le token
    const memRes = await pool.query(
      `SELECT id FROM business_account_members WHERE invite_token = $1`,
      [token]
    );
    if (memRes.rowCount === 0) {
      return res.status(404).json({ error: "Lien d'invitation invalide." });
    }
    const memberId: string = memRes.rows[0].id;

    // 2) Upload Cloudinary
    const [faceUrl, documentUrl] = await Promise.all([
      uploadBufferToCloudinary(faceFile.buffer, 'cash-hay/business_members/face'),
      uploadBufferToCloudinary(documentFile.buffer, 'cash-hay/business_members/document'),
    ]);

    // 3) Mise à jour du membre
    await pool.query(
      `
      UPDATE business_account_members
         SET is_verified = FALSE,        -- en attente de validation admin
             first_name = $1,
             last_name  = $2,
             doc_type   = $3,
             face_photo_url = $4,
             id_photo_url   = $5,
             submitted_at   = NOW()
       WHERE id = $6
      `,
      [firstName.trim(), lastName.trim(), docType.trim(), faceUrl, documentUrl, memberId]
    );

    // 4) Audit best-effort
    try {
      await pool.query(
        `INSERT INTO audit_logs (user_id, action, details, ip_address, user_agent, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          null,
          'verify_business_member_identity',
          `Member ${memberId} submitted identity`,
          (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '',
          req.headers['user-agent'] || 'N/A',
        ]
      );
    } catch {}

    return res.status(200).json({
      message: 'Documents soumis avec succès. En attente de validation.',
      faceUrl,
      documentUrl,
    });
  } catch (error) {
    console.error('❌ verifyBusinessMemberIdentity error:', error);
    return res.status(500).json({ error: 'Erreur lors de l’envoi des fichiers.' });
  }
};

/* --------------------------- Contrôleurs: Admin side ----------------------- */

/**
 * GET /api/admin/business/requests
 * Liste paginée simple (si besoin, ajoute limit/offset)
 */
export const adminListBusinessRequests = async (_req: Request, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT id, user_id, company_name, legal_status, business_type,
              contact_email_enc, contact_phone_enc, tax_id_enc,
              reason, members_count, created_at
         FROM business_account_requests
        ORDER BY created_at DESC`
    );

    const rows = r.rows.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      company_name: row.company_name,
      legal_status: row.legal_status,
      business_type: row.business_type,
      contact_email: decryptNullable(row.contact_email_enc) ?? null,
      contact_phone: decryptNullable(row.contact_phone_enc) ?? null,
      tax_id_masked:
        (decryptNullable(row.tax_id_enc) ?? '').replace(/.(?=.{4})/g, '•') || null,
      reason: row.reason,
      members_count: row.members_count,
      created_at: row.created_at,
    }));

    res.json({ requests: rows });
  } catch (err) {
    console.error('❌ adminListBusinessRequests error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

/**
 * GET /api/admin/business/requests/:id
 * Détail + documents + membres
 */
export const adminGetBusinessRequest = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const reqRes = await pool.query(
      `SELECT *
         FROM business_account_requests
        WHERE id = $1`,
      [id]
    );
    if (reqRes.rowCount === 0) {
      return res.status(404).json({ error: 'Demande introuvable.' });
    }
    const row = reqRes.rows[0];

    const docs = await pool.query(
      `SELECT id, filename, file_url, created_at
         FROM business_account_documents
        WHERE request_id = $1
        ORDER BY created_at DESC`,
      [id]
    );

    const members = await pool.query(
      `SELECT id, email, invite_token, is_verified, submitted_at,
              first_name, last_name, doc_type, face_photo_url, id_photo_url
         FROM business_account_members
        WHERE request_id = $1
        ORDER BY created_at DESC`,
      [id]
    );

    return res.json({
      request: {
        id: row.id,
        user_id: row.user_id,
        company_name: row.company_name,
        legal_status: row.legal_status,
        business_type: row.business_type,
        contact_email: decryptNullable(row.contact_email_enc) ?? null,
        contact_phone: decryptNullable(row.contact_phone_enc) ?? null,
        tax_id_masked:
          (decryptNullable(row.tax_id_enc) ?? '').replace(/.(?=.{4})/g, '•') || null,
        reason: row.reason,
        members_count: row.members_count,
        created_at: row.created_at,
      },
      documents: docs.rows,
      members: members.rows,
    });
  } catch (err) {
    console.error('❌ adminGetBusinessRequest error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

/**
 * GET /api/admin/business/requests/search?email=...&phone=...
 * Recherche par blind index (exact match).
 */
export const adminSearchBusinessRequests = async (req: Request, res: Response) => {
  try {
    const emailQ = normalizeEmail(req.query.email as string | undefined);
    const phoneQ = normalizePhone(req.query.phone as string | undefined);

    const clauses: string[] = [];
    const params: any[] = [];
    let p = 1;

    if (emailQ) {
      clauses.push(`contact_email_bidx = $${p++}`);
      params.push(blindIndexEmail(emailQ));
    }
    if (phoneQ) {
      clauses.push(`contact_phone_bidx = $${p++}`);
      params.push(blindIndexPhone(phoneQ));
    }

    if (clauses.length === 0) {
      return res.status(400).json({ error: 'Fournir email ou phone à rechercher.' });
    }

    const q = `
      SELECT id, user_id, company_name, legal_status, business_type,
             contact_email_enc, contact_phone_enc, tax_id_enc,
             reason, members_count, created_at
        FROM business_account_requests
       WHERE ${clauses.join(' OR ')}
       ORDER BY created_at DESC
       LIMIT 100
    `;

    const r = await pool.query(q, params);

    const rows = r.rows.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      company_name: row.company_name,
      legal_status: row.legal_status,
      business_type: row.business_type,
      contact_email: decryptNullable(row.contact_email_enc) ?? null,
      contact_phone: decryptNullable(row.contact_phone_enc) ?? null,
      tax_id_masked:
        (decryptNullable(row.tax_id_enc) ?? '').replace(/.(?=.{4})/g, '•') || null,
      reason: row.reason,
      members_count: row.members_count,
      created_at: row.created_at,
    }));

    res.json({ results: rows });
  } catch (err) {
    console.error('❌ adminSearchBusinessRequests error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};
