import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const verifyToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant ou invalide.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'devsecretkey') as Express.UserPayload;

    // ✅ Si le payload contient is_otp_verified: false → bloquer
    if (decoded.is_otp_verified === false) {
      return res.status(401).json({ error: 'OTP non vérifié. Veuillez compléter la vérification.' });
    }

    req.user = decoded;
    next();
  } catch (err) {
    console.error('Erreur de vérification du token :', err);
    return res.status(403).json({ error: 'Accès non autorisé.' });
  }
};


export default verifyToken;
