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
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Token manquant' });

  jwt.verify(token, process.env.JWT_SECRET || 'devsecretkey', (err, decoded) => {
    if (err) return res.status(403).json({ error: 'Token invalide' });

    req.user = decoded as AuthRequest['user'];
    next();
  });
};

// ✅ Middleware : Vérifie que l’utilisateur est admin
export const verifyAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
  }

  next();
};
