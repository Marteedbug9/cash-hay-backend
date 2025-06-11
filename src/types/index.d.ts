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
    }

    interface Request {
      user?: UserPayload;
      file?: MulterFile;
      files?: { [fieldname: string]: MulterFile[] };
    }
  }
}

export {};
