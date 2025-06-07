// src/routes/ipRoutes.ts
import { Router, Request, Response } from 'express';
import axios from 'axios';

const router = Router();

router.get('/ip-info', async (req: Request, res: Response) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const clientIP = Array.isArray(ip) ? ip[0] : ip?.split(',')[0] || '127.0.0.1';

  try {
    const response = await axios.get(`http://ip-api.com/json/${clientIP}`);
    return res.json(response.data);
  } catch (err) {
    console.error('❌ Erreur lors de la récupération IP info:', err);
    return res.status(500).json({ error: "Impossible d'obtenir les infos IP." });
  }
});

export default router;
