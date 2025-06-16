import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export const verifyToken = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant ou invalide.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'devsecretkey');

    if (typeof decoded !== 'object' || !('id' in decoded)) {
      return res.status(403).json({ error: 'Token invalide.' });
    }

    // Ajout correct sur req.user (déclaré dans tes types Express)
    req.user = decoded as Express.UserPayload;

    if (req.user?.is_otp_verified === false) {
      return res.status(401).json({ error: 'OTP non vérifié.' });
    }

    next();
  } catch (err) {
    console.error('❌ Erreur de vérification du token :', err);
    return res.status(403).json({ error: 'Accès non autorisé.' });
  }
};

export const verifyAdmin = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const user = req.user as Express.UserPayload;

  if (user?.role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
  }

  next();
};
