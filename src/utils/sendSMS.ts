// src/utils/sendSMS.ts
import client from './twilioClient';

const fromNumber = process.env.TWILIO_PHONE;

if (!fromNumber) {
  throw new Error('❌ TWILIO_PHONE est manquant dans le fichier .env');
}

export const sendSMS = async (to: string, message: string): Promise<void> => {
  try {
    const result = await client.messages.create({
      body: message,
      from: fromNumber,
      to,
    });

    console.log(`📲 SMS envoyé à ${to} ✅ SID: ${result.sid}`);
  } catch (error) {
    console.error('❌ Erreur lors de l’envoi du SMS :', error);
    throw new Error('Échec de l’envoi du SMS.');
  }
};
