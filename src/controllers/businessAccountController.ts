import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/db'; // adapte selon ton projet
import cloudinary from '../config/cloudinary';
import { File } from 'multer'; // ✅ ajoute ceci
import streamifier from 'streamifier';

// Helper pour générer un token (ici juste un UUID, sinon JWT si tu veux)
const generateToken = () => uuidv4();

export const createBusinessAccountRequest = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "Utilisateur non authentifié." });
    }
    const user_id = req.user.id;
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
    } = req.body;
    const files = req.files as Express.Multer.File[];

    // 1. Insère la demande principale
    const requestInsert = await db.query(
      `INSERT INTO business_account_requests
        (user_id, company_name, legal_status, business_type, tax_id, contact_email, contact_phone, reason, members_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        user_id,
        company_name,
        legal_status,
        business_type,
        tax_id,
        contact_email,
        contact_phone,
        reason,
        members_count,
      ]
    );
    const requestId = requestInsert.rows[0].id;

    // 2. Membres
    let emails: string[] = [];
    if (Array.isArray(members_emails)) {
      emails = members_emails.filter(e => e && typeof e === 'string' && e.trim());
    } else if (typeof members_emails === 'string' && members_emails.trim()) {
      emails = [members_emails.trim()];
    }
    for (const email of emails) {
      const token = generateToken();
      await db.query(
        `INSERT INTO business_account_members (request_id, email, invite_token)
         VALUES ($1, $2, $3)`,
        [requestId, email, token]
      );
      const verificationLink = `https://cash-hay.com/verify-business-member/${token}`;
      console.log(`Email envoyé à ${email}: Cliquez ici pour vérification d'identité : ${verificationLink}`);
      // TODO: sendMail(email, subject, message);
    }

    // 3. Documents Cloudinary (file.path = URL Cloudinary)
    for (const file of files || []) {
      await db.query(
        `INSERT INTO business_account_documents (request_id, filename, file_url)
         VALUES ($1, $2, $3)`,
        [requestId, file.originalname, file.path]
      );
    }

    res.status(201).json({ message: "Demande business enregistrée et invitations envoyées !" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
};



export const verifyBusinessMemberIdentity = async (req: Request, res: Response) => {
  try {
    const { token, firstName, lastName, docType } = req.body;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

    if (!token || !firstName || !lastName || !docType || !files?.face || !files?.document) {
      return res.status(400).json({ error: "Champs requis manquants." });
    }

    const faceFile = files.face[0];
    const documentFile = files.document[0];

    // 1. Vérifie le membre à partir du token
    const { rows } = await db.query(
      'SELECT id FROM business_account_members WHERE invite_token = $1',
      [token]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Lien d'invitation invalide." });
    const memberId = rows[0].id;

    // 2. Upload Cloudinary (Buffer → Cloudinary Stream)
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

    const [faceUrl, documentUrl] = await Promise.all([
      uploadToCloudinary(faceFile.buffer, 'cash-hay/business_members/face'),
      uploadToCloudinary(documentFile.buffer, 'cash-hay/business_members/document')
    ]);

    // 3. Met à jour le membre avec toutes les infos
    await db.query(`
      UPDATE business_account_members
      SET
        is_verified = FALSE, -- admin validera après
        first_name = $1,
        last_name = $2,
        doc_type = $3,
        face_photo_url = $4,
        id_photo_url = $5,
        submitted_at = NOW()
      WHERE id = $6
    `, [
      firstName,
      lastName,
      docType,
      faceUrl,
      documentUrl,
      memberId
    ]);

    // 4. Audit log (optionnel)
    await db.query(
      `INSERT INTO audit_logs (user_id, action, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        null, // tu peux relier au membre user si besoin
        'verify_business_member_identity',
        `Business member identity submitted.`,
        req.headers['x-forwarded-for'] || req.socket.remoteAddress,
        req.headers['user-agent'] || 'N/A'
      ]
    );

    return res.status(200).json({
      message: 'Documents soumis avec succès. En attente de validation.',
      faceUrl,
      documentUrl
    });

  } catch (error) {
    console.error('❌ Erreur business verify:', error);
    return res.status(500).json({ error: 'Erreur lors de l’envoi des fichiers.' });
  }
};