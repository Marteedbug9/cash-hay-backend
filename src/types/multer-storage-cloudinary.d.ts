declare module 'multer-storage-cloudinary' {
  import { StorageEngine } from 'multer';
  import { ConfigOptions, UploadApiOptions, UploadApiResponse } from 'cloudinary';

  interface CloudinaryStorageOptions {
    cloudinary: any;
    params?: UploadApiOptions | (() => UploadApiOptions | Promise<UploadApiOptions>);
  }

  export class CloudinaryStorage implements StorageEngine {
    constructor(options: CloudinaryStorageOptions);
  }
}
