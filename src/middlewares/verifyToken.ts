import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type {MulterRequest } from '../types';


interface JwtPayload {
  id: string;
  email?: string;
  role?: 'admin' | 'user';
}

interface AuthRequest extends Request {
  user?: JwtPayload;
}

const verifyToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant ou invalide.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'devsecretkey') as JwtPayload;
    req.user = decoded;
    next();
  } catch (err) {
    console.error('Erreur de vérification du token :', err);
    return res.status(403).json({ error: 'Accès non autorisé.' });
  }
};

export default verifyToken;
export type { AuthRequest, JwtPayload };
