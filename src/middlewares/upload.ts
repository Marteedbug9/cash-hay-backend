import * as multer from 'multer';

const storage = multer.memoryStorage();
const upload = multer.default({ storage }); // Utilise `.default` si erreur persiste

export default upload;
