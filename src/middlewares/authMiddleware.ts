import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';



export interface AuthRequest extends Request {
  user?: {
    id: string;
    email?: string;
    role?: 'admin' | 'user';
  };
}

// ✅ Middleware : Vérifie le token JWT
export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'devsecretkey') as AuthRequest['user'];
    req.user = decoded;
    next();
  } catch (err) {
    console.error('❌ Erreur de vérification du token :', err);
    return res.status(403).json({ error: 'Token invalide' });
  }
};

export const verifyAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
  }

  next();
};