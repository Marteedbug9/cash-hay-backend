// src/types/index.d.ts
import { Request } from 'express';
import type { File as MulterFile } from 'multer';

export interface MulterRequest extends Request {
  files?: {
    face?: MulterFile[];
    document?: MulterFile[];
  };
}
