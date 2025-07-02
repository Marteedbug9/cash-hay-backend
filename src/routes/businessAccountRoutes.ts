import express, { Request, Response } from 'express';
import multer from 'multer';
import cloudinary from '../config/cloudinary'; // Ton fichier de config Cloudinary
import { v4 as uuidv4 } from 'uuid';

const upload = multer({ storage: multer.memoryStorage() }); // POUR BUFFER !

const router = express.Router();

interface BusinessAccountRequestBody {
  company_name: string;
  business_type: string;
  tax_id: string;
  contact_email?: string;
  contact_phone?: string;
  reason?: string;
  members_count: string | number;
  members_emails: string[] | string;
}

// Helper upload Cloudinary
const uploadToCloudinary = (fileBuffer: Buffer, folder: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder },
      (error: any, result: any) => {
        if (error || !result) return reject(error);
        resolve(result.secure_url);
      }
    );
    stream.end(fileBuffer);
  });
};

router.post(
  '/business-account-request',
  upload.array('documents'), // "documents" = clé utilisée côté frontend FormData
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

      // UPLOAD documents sur Cloudinary et récupère les URLs
      let documentUrls: string[] = [];
      if (files && files.length > 0) {
        documentUrls = await Promise.all(
          files.map(file =>
            uploadToCloudinary(file.buffer, 'cash-hay/business_requests')
          )
        );
      }

      // Ici tu continues: insert BDD, envoie d'invitation, etc.
      // Ex:
      // await db.query("INSERT INTO ...", [...data, documentUrls...])

      res.status(201).json({
        message: "Demande reçue ! Upload Cloudinary OK.",
        emails,
        documentUrls
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }
);

export default router;
