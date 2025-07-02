import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import db from '../config/db';
import { sendPushNotification, sendEmail, sendSMS } from '../utils/notificationUtils';

function generateTempPassword(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@$#';
  let pass = '';
  for (let i = 0; i < length; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length));
  return pass;
}

export const approveBusinessAccount = async (req: Request, res: Response) => {
  try {
    const { requestId } = req.body;

    // 1. Change status
    await db.query(
      `UPDATE business_account_requests SET status='approved' WHERE id=$1`,
      [requestId]
    );

    // 2. Récupère le contact_email du business
    const { rows: businessRows } = await db.query(
      'SELECT contact_email, company_name FROM business_account_requests WHERE id = $1',
      [requestId]
    );
    if (!businessRows.length) return res.status(404).json({ error: 'Business not found' });
    const { contact_email, company_name } = businessRows[0];

    // 3. Crée business_user pour le contact principal
    const { rows: exists } = await db.query(
      'SELECT id FROM business_user WHERE email = $1',
      [contact_email]
    );
    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    if (!exists.length) {
      await db.query(
        `INSERT INTO business_user (email, password_hash, must_change_password, business_account_request_id)
         VALUES ($1, $2, TRUE, $3)`,
        [contact_email, passwordHash, requestId]
      );
      // Email au contact principal
      sendEmail({
        to: contact_email,
        subject: 'Votre accès Cash Hay Pay',
        text: `Bonjour,\n\nVotre business "${company_name}" est validé !\nVotre mot de passe temporaire est : ${tempPassword}\nConnectez-vous ici : https://cash-hay.com/business-login\nMerci de changer votre mot de passe dès la première connexion.`
      });
    }

    // 4. Crée ou reset business_user pour chaque membre
    const { rows: members } = await db.query(
      'SELECT email FROM business_account_members WHERE request_id = $1',
      [requestId]
    );
    for (const member of members) {
      const email = member.email;
      const tempPwd = generateTempPassword();
      const pwdHash = await bcrypt.hash(tempPwd, 10);
      const { rows: memberExists } = await db.query(
        'SELECT id FROM business_user WHERE email = $1',
        [email]
      );
      if (!memberExists.length) {
        await db.query(
          `INSERT INTO business_user (email, password_hash, must_change_password, business_account_request_id)
           VALUES ($1, $2, TRUE, $3)`,
          [email, pwdHash, requestId]
        );
      } else {
        await db.query(
          `UPDATE business_user SET password_hash = $1, must_change_password = TRUE WHERE email = $2`,
          [pwdHash, email]
        );
      }
      // Email à chaque membre
      sendEmail({
        to: email,
        subject: 'Votre accès Cash Hay Pay',
        text: `Bonjour,\n\nVotre accès au business "${company_name}" est validé !\nVotre mot de passe temporaire est : ${tempPwd}\nConnectez-vous ici : https://cash-hay.com/business-login\nMerci de changer votre mot de passe dès la première connexion.`
      });
    }

    res.json({ success: true, message: "Business approuvé, accès envoyés à tous les membres." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};
