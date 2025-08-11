// src/types/index.d.ts
import type { File as MulterFile } from 'multer';

declare global {
  namespace Express {
    interface UserPayload {
      id: string;
      email?: string;
       username?: string; 
      role?: 'admin' | 'user';
      is_otp_verified?: boolean;
      first_name?: string;   // Ajoute ici
      last_name?: string;    // Ajoute ici
      phone?: string;        // Ajoute ici
      photo_url?: string;    // Ajoute ici
    }

    interface Request {
      user?: UserPayload;
      admin?: UserPayload;           
      file?: MulterFile;
      files?: { [fieldname: string]: MulterFile[] };
    }
  }
}

export {};
