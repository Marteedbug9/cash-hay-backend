declare module 'multer-storage-cloudinary' {
  import { StorageEngine } from 'multer';
  import { UploadApiOptions } from 'cloudinary';
  import { Request } from 'express';

  interface CloudinaryStorageOptions {
    cloudinary: any;
    params?: UploadApiOptions | (() => UploadApiOptions | Promise<UploadApiOptions>);
  }

  export class CloudinaryStorage implements StorageEngine {
    constructor(options: CloudinaryStorageOptions);

    _handleFile(
      req: Request,
      file: Express.Multer.File,
      callback: (error?: any, info?: Partial<Express.Multer.File>) => void
    ): void;

    _removeFile(
      req: Request,
      file: Express.Multer.File,
      callback: (error: Error) => void
    ): void;
  }
}
