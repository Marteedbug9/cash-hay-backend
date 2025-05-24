import twilio from 'twilio';
import dotenv from 'dotenv';

dotenv.config();

const accountSid = process.env.TWILIO_ACCOUNT_SID!;
const authToken = process.env.TWILIO_AUTH_TOKEN!;
const fromNumber = process.env.TWILIO_PHONE_NUMBER!;

const client = twilio(accountSid, authToken);

const sendSMS = async (to: string, message: string): Promise<void> => {
  try {
    await client.messages.create({
      body: message,
      from: fromNumber,
      to: to,
    });
  } catch (error) {
    console.error('Erreur lors de l’envoi du SMS :', error);
    throw error;
  }
};

export default sendSMS;
