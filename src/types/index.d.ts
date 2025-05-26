// src/types/index.d.ts
import { Request } from 'express';
import type { File as MulterFile } from 'multer';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email?: string;
    username?: string;
    role?: string;
  };
}

export interface MulterRequest extends Request {
  files?: {
    face?: MulterFile[];
    document?: MulterFile[];
  };
}
