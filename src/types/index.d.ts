// src/types/index.d.ts
import { Request } from 'express';
import type { File as MulterFile } from 'multer';

declare global {
  namespace Express {
    interface UserPayload {
      id: string;
      email?: string;
      role?: 'admin' | 'user';
      is_otp_verified?: boolean; // ✅ Ajout ici
    }

    interface Request {
      user?: UserPayload;
      files?: {
        face?: MulterFile[];
        document?: MulterFile[];
      };
    }
  }
}

export {};
