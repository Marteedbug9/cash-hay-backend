import { Request, Response } from 'express';
import db from '../config/db';
import { sendEmail, sendSMS } from '../utils/notificationUtils';

// ✅ Envoyer une alerte à un utilisateur
export const sendAlertToUser = async (req: Request, res: Response) => {
  const { user_id, type, message } = req.body;

  if (!user_id || !type || !message) {
    return res.status(400).json({ error: 'Champs requis manquants.' });
  }

  try {
    const result = await db.query(
      'SELECT email, phone FROM users WHERE id = $1',
      [user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé.' });
    }

    const { email, phone } = result.rows[0];

    if (type === 'email' || type === 'both') {
      await sendEmail({
        to: email,
        subject: 'Alerte de sécurité Cash Hay',
        text: message,
      });
    }

    if (type === 'sms' || type === 'both') {
      await sendSMS(phone, message);
    }

    return res.status(200).json({ success: true, message: 'Alerte envoyée.' });
  } catch (error) {
    console.error('Erreur envoi alerte :', error);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};
