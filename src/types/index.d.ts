// src/types/index.d.ts
import type { File as MulterFile } from 'multer';

declare global {
  namespace Express {
    interface User {
      id: string;
      email?: string;
      role?: 'admin' | 'user';
      is_otp_verified?: boolean;
    }

    interface Request {
      user?: User;
      file?: MulterFile; // Pour .single()
      files?: { [fieldname: string]: MulterFile[] }; // Pour .fields()
    }
  }
}

export {};
