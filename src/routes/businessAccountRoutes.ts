import express, { Request, Response } from 'express';
import multer from 'multer';
import cloudinary from '../config/cloudinary'; // Fichier config cloudinary
import db from '../config/db'; // Fichier config PostgreSQL
import { v4 as uuidv4 } from 'uuid';

const upload = multer({ storage: multer.memoryStorage() }); // Buffer

const router = express.Router();

interface BusinessAccountRequestBody {
  company_name: string;
  legal_status?: string; // Forme légale (SARL, SA, etc.), si tu veux la gérer
  business_type: string;
  tax_id: string;
  contact_email?: string;
  contact_phone?: string;
  reason?: string;
  members_count: string | number;
  members_emails: string[] | string;
}

// Helper upload Cloudinary
const uploadToCloudinary = (fileBuffer: Buffer, fileName: string, folder: string): Promise<{ url: string, name: string }> => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "auto", public_id: fileName.replace(/\.[^/.]+$/, "") },
      (error: any, result: any) => {
        if (error || !result) return reject(error);
        resolve({ url: result.secure_url, name: result.original_filename });
      }
    );
    stream.end(fileBuffer);
  });
};

router.post(
  '/business-account-request',
  upload.array('documents'), // "documents" = clé côté frontend FormData
  async (req: Request, res: Response) => {
    try {
      const data = req.body as BusinessAccountRequestBody;
      let emails: string[] = [];
      if (Array.isArray(data.members_emails)) {
        emails = data.members_emails;
      } else if (typeof data.members_emails === 'string') {
        emails = [data.members_emails];
      }

      const files = req.files as Express.Multer.File[];

      // 1. Upload documents Cloudinary (get array {name, url})
      let documentObjs: { url: string, name: string }[] = [];
      if (files && files.length > 0) {
        documentObjs = await Promise.all(
          files.map(file =>
            uploadToCloudinary(file.buffer, file.originalname, 'cash-hay/business_requests')
          )
        );
      }

      // 2. Insertion principale (user_id à récupérer selon ton auth, sinon null)
      const user_id = (req as any).user?.id || null;
      const { company_name, legal_status, business_type, tax_id, contact_email, contact_phone, reason, members_count } = data;
      const requestInsert = await db.query(
        `INSERT INTO business_account_requests
         (user_id, company_name, legal_status, business_type, tax_id, contact_email, contact_phone, reason, members_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [user_id, company_name, legal_status, business_type, tax_id, contact_email, contact_phone, reason, members_count]
      );
      const requestId = requestInsert.rows[0].id;

      // 3. Membres
      for (const email of emails) {
        const token = uuidv4();
        await db.query(
          `INSERT INTO business_account_members (request_id, email, invite_token)
           VALUES ($1, $2, $3)`,
          [requestId, email, token]
        );
        // Option: envoyer email ici
      }

      // 4. Enregistrement des documents (url Cloudinary)
      for (const doc of documentObjs) {
        await db.query(
          `INSERT INTO business_account_documents (request_id, filename, file_url)
           VALUES ($1, $2, $3)`,
          [requestId, doc.name, doc.url]
        );
      }

      res.status(201).json({
        message: "Demande reçue ! Upload Cloudinary OK.",
        emails,
        documents: documentObjs,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }
);

export default router;
