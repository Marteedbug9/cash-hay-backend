// src/routes/businessAccountRoutes.ts
import express, { Request, Response } from 'express';
import multer from 'multer';
import cloudinary from '../config/cloudinary';
import db from '../config/db';
import { v4 as uuidv4 } from 'uuid';
import { encrypt, blindIndexEmail, blindIndexPhone } from '../utils/crypto';

const upload = multer({ storage: multer.memoryStorage() }); // fichiers en mémoire (Buffer)
const router = express.Router();

interface BusinessAccountRequestBody {
  company_name: string;
  legal_status?: string;
  business_type: string;
  tax_id?: string;
  contact_email?: string;
  contact_phone?: string;
  reason?: string;
  members_count?: string | number;
  members_emails?: string[] | string;
}

// --- Helpers ---
const isEmail = (v?: string) =>
  !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim().toLowerCase());

const isPhone = (v?: string) =>
  !!v && /[\d+]{6,}/.test(v.replace(/[^\d+]/g, ''));

const toInt = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

// Upload buffer -> Cloudinary
const uploadToCloudinary = (
  fileBuffer: Buffer,
  fileName: string,
  folder: string
): Promise<{ url: string; name: string }> => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'auto',
        public_id: fileName.replace(/\.[^/.]+$/, ''),
      },
      (error: any, result: any) => {
        if (error || !result) return reject(error);
        resolve({ url: result.secure_url, name: result.original_filename });
      }
    );
    stream.end(fileBuffer);
  });
};

/**
 * POST /api/business/business-account-request
 * FormData:
 *  - company_name (required)
 *  - business_type (required)
 *  - legal_status, tax_id, contact_email, contact_phone, reason, members_count, members_emails
 *  - documents[] (files)
 */
router.post(
  '/business-account-request',
  upload.array('documents'),
  async (req: Request, res: Response) => {
    const client = await db.connect();
    try {
      const body = req.body as BusinessAccountRequestBody;

      // --- Normalisation / validations rapide ---
      const company_name = (body.company_name || '').trim();
      const business_type = (body.business_type || '').trim();
      const legal_status = (body.legal_status || '').trim() || null;
      const reason = (body.reason || '').trim() || null;

      if (!company_name) {
        return res.status(400).json({ error: 'company_name requis' });
      }
      if (!business_type) {
        return res.status(400).json({ error: 'business_type requis' });
      }

      const tax_id = (body.tax_id || '').trim() || null;

      // email / phone (facultatifs mais si fournis → valides)
      const contact_email_raw = (body.contact_email || '').trim().toLowerCase() || null;
      if (contact_email_raw && !isEmail(contact_email_raw)) {
        return res.status(400).json({ error: 'contact_email invalide' });
      }
      const contact_phone_raw = (body.contact_phone || '').trim() || null;
      const contact_phone_norm = contact_phone_raw
        ? contact_phone_raw.replace(/[^\d+]/g, '')
        : null;
      if (contact_phone_norm && !isPhone(contact_phone_norm)) {
        return res.status(400).json({ error: 'contact_phone invalide' });
      }

      // members_count
      const members_count = toInt(body.members_count, 0);

      // members_emails: array|string -> string[] normalisée & unique
      let members_emails: string[] = [];
      if (Array.isArray(body.members_emails)) {
        members_emails = body.members_emails;
      } else if (typeof body.members_emails === 'string' && body.members_emails.trim()) {
        members_emails = [body.members_emails];
      }
      members_emails = [
        ...new Set(
          members_emails
            .map((e) => (e || '').trim().toLowerCase())
            .filter((e) => e && isEmail(e))
        ),
      ];

      // Fichiers reçus
      const files = (req.files as Express.Multer.File[]) || [];

      // --- 1) Upload Cloudinary (en amont, ainsi on a les URLs)
      let documentObjs: { url: string; name: string }[] = [];
      if (files.length > 0) {
        documentObjs = await Promise.all(
          files.map((file) =>
            uploadToCloudinary(file.buffer, file.originalname, 'cash-hay/business_requests')
          )
        );
      }

      // --- 2) DB transaction
      await client.query('BEGIN');

      // user_id depuis le token (si présent)
      const user_id = (req as any).user?.id || null;

      // Chiffrage / blind index (champs désormais encodés)
      const contact_email_enc = contact_email_raw ? encrypt(contact_email_raw) : null;
      const contact_email_bidx = contact_email_raw ? blindIndexEmail(contact_email_raw) : null;

      const contact_phone_enc = contact_phone_norm ? encrypt(contact_phone_norm) : null;
      const contact_phone_bidx = contact_phone_norm ? blindIndexPhone(contact_phone_norm) : null;

      const tax_id_enc = tax_id ? encrypt(tax_id) : null;

      // INSERT request (nouveau schéma avec *_enc / *_bidx)
      const reqIns = await client.query(
        `
        INSERT INTO business_account_requests (
          user_id,
          company_name,
          legal_status,
          business_type,
          tax_id_enc,
          contact_email_enc,
          contact_email_bidx,
          contact_phone_enc,
          contact_phone_bidx,
          reason,
          members_count,
          status,
          created_at,
          updated_at
        ) VALUES (
          $1,$2,$3,$4,
          $5,
          $6,$7,
          $8,$9,
          $10,$11,
          'pending',
          NOW(), NOW()
        )
        RETURNING id
        `,
        [
          user_id,
          company_name,
          legal_status,
          business_type,
          tax_id_enc,
          contact_email_enc,
          contact_email_bidx,
          contact_phone_enc,
          contact_phone_bidx,
          reason,
          members_count,
        ]
      );

      const requestId: string = reqIns.rows[0].id;

      // INSERT members (emails en clair ici par design de ta table actuelle)
      for (const email of members_emails) {
        const token = uuidv4();
        await client.query(
          `INSERT INTO business_account_members (request_id, email, invite_token, created_at)
           VALUES ($1, $2, $3, NOW())`,
          [requestId, email, token]
        );
        // TODO: envoyer les emails d’invitation (feat à part)
      }

      // INSERT documents (urls Cloudinary)
      for (const doc of documentObjs) {
        await client.query(
          `INSERT INTO business_account_documents (request_id, filename, file_url, created_at)
           VALUES ($1, $2, $3, NOW())`,
          [requestId, doc.name, doc.url]
        );
      }

      await client.query('COMMIT');

      return res.status(201).json({
        message: 'Demande reçue. Documents uploadés et demande enregistrée.',
        requestId,
        members_count,
        members_emails,
        documents: documentObjs,
      });
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {}
      console.error('❌ business-account-request error:', err);
      return res.status(500).json({ error: 'Erreur serveur' });
    } finally {
      client.release();
    }
  }
);

export default router;
