exports.maskEmail = (email) => {
  const [user, domain] = email.split('@');
  return user.slice(0, 1) + '***' + user.slice(-1) + '@' + domain;
};

exports.sendSecurityAlertEmail = async (to) => {
  // Utilise nodemailer par exemple
  const content = `
Quelqu’un a essayé de réinitialiser votre mot de passe.
Si ce n’est pas vous, répondez avec "NON" immédiatement pour bloquer l’accès.
  `;
  await sendEmail(to, 'Alerte Sécurité', content);
};

exports.generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

exports.sendOTP = async (phone, email, otp) => {
  await sendEmail(email, 'Votre code de réinitialisation', `Code: ${otp}`);
  await sendSMS(phone, `Votre code est : ${otp}`);
};

exports.storeOTP = async (userId, otp) => {
  // Enregistre l’OTP dans ta DB ou Redis (exemple simple ici)
  await db.query('INSERT INTO otps (user_id, code, created_at) VALUES (?, ?, NOW())', [userId, otp]);
};
