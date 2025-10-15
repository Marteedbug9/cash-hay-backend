// src/utils/notificationUtils.ts
import twilio from 'twilio';
import dotenv from 'dotenv';
import sendEmail from './sendEmail'; // ✅ on délègue l'email au module unique

dotenv.config();

/* ===========================
   TWILIO (SMS)
=========================== */
const TWILIO_SID = process.env.TWILIO_SID!;
const TWILIO_TOKEN = process.env.TWILIO_TOKEN!;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

if (!TWILIO_SID || !TWILIO_TOKEN) {
  console.warn('⚠️ TWILIO_SID ou TWILIO_TOKEN manquant dans .env');
}
if (!TWILIO_PHONE_NUMBER) {
  console.warn('⚠️ TWILIO_PHONE_NUMBER manquant dans .env (sendSMS échouera).');
}

const twilioClient = twilio(TWILIO_SID, TWILIO_TOKEN);

export const sendSMS = async (phone: string, message: string): Promise<void> => {
  if (!TWILIO_PHONE_NUMBER) throw new Error('TWILIO_PHONE_NUMBER manquant dans .env');

  try {
    const result = await twilioClient.messages.create({
      body: message,
      to: phone,
      from: TWILIO_PHONE_NUMBER,
    });
    console.log(`📱 SMS envoyé à ${phone} ✅ SID: ${result.sid}`);
  } catch (error: unknown) {
    console.error('❌ Erreur lors de l’envoi du SMS :', (error as any)?.message || error);
    // Ne lève pas par défaut pour ne pas casser le flux — à ajuster selon ton besoin
  }
};

/* ===========================
   PUSH (Expo)
=========================== */
export const sendPushNotification = async (
  expoPushToken: string,
  title: string,
  body: string
): Promise<void> => {
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to: expoPushToken, sound: 'default', title, body }),
    });
    const data = await res.json();
    console.log('📲 PUSH envoyée:', data);
  } catch (err: unknown) {
    console.error('❌ Erreur lors de l’envoi de la notification push:', (err as any)?.message || err);
  }
};

/* ===========================
   NOTIFY (orchestrateur)
=========================== */
export const notifyUser = async ({
  expoPushToken,
  email,
  phone,
  title,
  body,
  subject,
  sms,
  emailText,
  emailHtml,
}: {
  expoPushToken?: string;
  email?: string;
  phone?: string;
  title: string;      // utilisé pour PUSH
  body: string;       // utilisé pour PUSH et fallback email text
  subject?: string;   // requis si email
  sms?: string;       // texte SMS (sinon pas d’envoi SMS)
  emailText?: string; // texte email explicite (sinon fallback = body)
  emailHtml?: string; // version HTML de l’email
}) => {
  try {
    const tasks: Promise<any>[] = [];

    if (expoPushToken) tasks.push(sendPushNotification(expoPushToken, title, body));

    if (email && subject) {
      tasks.push(
        sendEmail({
          to: email,
          subject,
          text: emailText ?? body,
          html: emailHtml,
        }).catch((e: any) => console.error('❌ Email notifyUser:', e?.message || e))
      );
    }

    if (phone && sms) {
      tasks.push(
        sendSMS(phone, sms).catch((e: any) => console.error('❌ SMS notifyUser:', e?.message || e))
      );
    }

    await Promise.allSettled(tasks);
  } catch (err: unknown) {
    console.error('❌ Erreur dans notifyUser :', (err as any)?.message || err);
  }
};

// ✅ Ré-export propre pour que les autres modules puissent `import { sendEmail } from './notificationUtils'`
export { default as sendEmail } from './sendEmail';
