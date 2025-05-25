// src/types/index.d.ts
import { Request } from 'express';

export interface MulterRequest extends Request {
  files?: {
    face?: Express.Multer.File[];
    document?: Express.Multer.File[];
  };
}
