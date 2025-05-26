import multer, { FileFilterCallback } from 'multer';

const storage = multer.memoryStorage();
const upload = multer({ storage });

export default upload;
