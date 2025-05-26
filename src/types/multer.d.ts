// src/types/multer.d.ts
declare module 'multer' {
  import { RequestHandler } from 'express';

  export interface File {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
    destination?: string;
    filename?: string;
    path?: string;
  }

  export interface Multer {
    single(fieldname: string): RequestHandler;
    array(fieldname: string, maxCount?: number): RequestHandler;
    fields(fields: Array<{ name: string; maxCount?: number }>): RequestHandler;
  }

  export function memoryStorage(): any;

  function multer(options?: any): Multer;

  export = multer;
}
