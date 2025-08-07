// src/middlewares/handleMarqetaWebhook.ts
import { Request, Response, NextFunction } from 'express';
import { MARQETA_WEBHOOK_USER, MARQETA_WEBHOOK_PASS } from '../webhooks/marqeta';

export const verifyMarqetaAuth = (req: Request, res: Response, next: NextFunction) => {
  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith('Basic ')) {
    return res.status(401).send('Unauthorized');
  }

  const base64 = auth.split(' ')[1];
  const [user, pass] = Buffer.from(base64, 'base64').toString().split(':');

  if (user !== MARQETA_WEBHOOK_USER || pass !== MARQETA_WEBHOOK_PASS) {
    return res.status(403).send('Forbidden');
  }

  next(); // Authentification OK → passe au contrôleur
};
