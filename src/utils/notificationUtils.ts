// src/utils/notificationUtils.ts
import twilio from 'twilio';
import dotenv from 'dotenv';
import sendEmail from './sendEmail'; // ✅ on délègue l'email au module unique

dotenv.config();

/* ===========================
   TWILIO (SMS)
=========================== */
// ✅ Supporte 2 conventions d'ENV : (TWILIO_SID, TWILIO_TOKEN) ou (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
const TWILIO_SID =
  process.env.TWILIO_SID || process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_TOKEN =
  process.env.TWILIO_TOKEN || process.env.TWILIO_AUTH_TOKEN || '';

// ✅ Préférence : Messaging Service SID (meilleure délivrabilité/routage), sinon numéro
const TWILIO_MESSAGING_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

if (!TWILIO_SID || !TWILIO_TOKEN) {
  console.warn('⚠️ TWILIO_SID/TWILIO_TOKEN ou TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN manquants dans .env');
}
if (!TWILIO_MESSAGING_SERVICE_SID && !TWILIO_PHONE_NUMBER) {
  console.warn('⚠️ Ni TWILIO_MESSAGING_SERVICE_SID ni TWILIO_PHONE_NUMBER n’est défini (sendSMS échouera).');
}

// ⚠️ Initialise le client seulement si les creds existent
const twilioClient = (TWILIO_SID && TWILIO_TOKEN)
  ? twilio(TWILIO_SID, TWILIO_TOKEN)
  : null;

export const sendSMS = async (phone: string, message: string): Promise<void> => {
  if (!twilioClient) {
    throw new Error('Twilio non configuré : SID/TOKEN manquants.');
  }
  if (!TWILIO_MESSAGING_SERVICE_SID && !TWILIO_PHONE_NUMBER) {
    throw new Error('Aucun expéditeur SMS défini (TWILIO_MESSAGING_SERVICE_SID ou TWILIO_PHONE_NUMBER).');
  }

  try {
    const params: Record<string, string> = {
      body: message,
      to: phone, // ⚠️ idéalement en E.164 (+509..., +1..., etc.)
    };
    if (TWILIO_MESSAGING_SERVICE_SID) {
      params['messagingServiceSid'] = TWILIO_MESSAGING_SERVICE_SID;
    } else if (TWILIO_PHONE_NUMBER) {
      params['from'] = TWILIO_PHONE_NUMBER;
    }

    const result = await twilioClient.messages.create(params as any);
    console.log(`📱 SMS envoyé à ${phone} ✅ SID: ${result.sid}`);
  } catch (error: unknown) {
    console.error('❌ Erreur lors de l’envoi du SMS :', (error as any)?.message || error);
    // Ne pas throw par défaut pour ne pas casser le flux — adapte selon ton besoin
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
