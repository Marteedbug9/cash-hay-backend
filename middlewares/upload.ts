import multer from 'multer';
import dotenv from 'dotenv';

dotenv.config();

// 👉 On utilise memoryStorage pour accéder au buffer du fichier
const storage = multer.memoryStorage();

const upload = multer({ storage });

export default upload;