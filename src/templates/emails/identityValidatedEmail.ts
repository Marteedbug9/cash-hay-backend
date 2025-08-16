// backend/src/templates/emails/identityValidatedEmail.ts
export function buildIdentityValidatedEmail({
  firstName = '',
  lastName = '',
  loginUrl = process.env.APP_LOGIN_URL || 'https://app.cash-hay.com/login',
  reward = 25, // si tu offres un bonus de parrainage après validation
}: {
  firstName?: string;
  lastName?: string;
  loginUrl?: string;
  reward?: number;
}) {
  const subject = 'Votre identité a été validée ✅';

  const text = `Bienvenue ${firstName} ${lastName},

Votre identité a été validée avec succès. Toute l’équipe Cash Hay est heureuse de vous accueillir !

Vous pouvez maintenant :
- Inviter vos amis à rejoindre Cash Hay (bonus de ${reward} HTG par parrainage après validation).
- Transférer votre argent simplement, rapidement et en toute sécurité.
- Demander votre carte physique et la personnaliser depuis l’app.
- Rester conforme en respectant nos Conditions d’utilisation et les normes internationales.

Accéder à mon compte : ${loginUrl}

Besoin d’aide ? support@cash-hay.com
Suivez-nous : LinkedIn / X / Instagram / Facebook

© Cash Hay – Tous droits réservés`;

  const html = `<!doctype html>
<html lang="fr" style="margin:0;padding:0;">
  <body style="margin:0;padding:0;background:#FFFFFF;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <!-- Container -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #000000;">
            <!-- Header / Logo -->
            <tr>
              <td align="center" style="padding:28px 24px 10px;">
                <img src="https://res.cloudinary.com/dmwcxkzs3/image/upload/v1755125913/ChatGPT_Image_Jul_27_2025_01_38_46_PM_qsxzai.png"
                     width="120" height="120" alt="Cash Hay"
                     style="display:block;width:120px;height:120px;border:0;outline:none;text-decoration:none;border-radius:12px" />
              </td>
            </tr>

            <!-- Titre -->
            <tr>
              <td align="center" style="padding:6px 24px 0;">
                <h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:32px;color:#000000;">
                  Bienvenue ${firstName ? firstName : ''} ${lastName ? lastName : ''}
                </h1>
              </td>
            </tr>

            <!-- Message principal -->
            <tr>
              <td align="center" style="padding:14px 28px 8px;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#000000;">
                  <strong>Votre identité a été validée avec succès.</strong><br/>
                  Toute la famille Cash Hay est heureuse de vous accueillir&nbsp;!
                </p>
              </td>
            </tr>

            <!-- Ce que vous pouvez faire -->
            <tr>
              <td align="left" style="padding:14px 28px 0;">
                <p style="margin:0 0 10px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:#000000;">
                  Vous pouvez maintenant :
                </p>
                <ul style="margin:0 0 0 20px;padding:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:#000000;">
                  <li>Inviter vos amis à rejoindre Cash Hay <em>(bonus de ${reward}&nbsp;HTG par parrainage après validation)</em>.</li>
                  <li>Transférer votre argent — simple, rapide et sécurisé.</li>
                  <li>Demander votre carte physique et la personnaliser depuis l’app.</li>
                  <li>Respecter nos Conditions d’utilisation et les normes internationales (KYC/AML).</li>
                </ul>
              </td>
            </tr>

            <!-- Bouton -->
            <tr>
              <td align="center" style="padding:18px 28px 8px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td bgcolor="#16A34A" style="border-radius:10px;">
                      <a href="${loginUrl}"
                         style="display:inline-block;padding:12px 22px;font-family:Arial,Helvetica,sans-serif;font-size:16px;color:#FFFFFF;text-decoration:none;border-radius:10px;"
                         target="_blank" rel="noopener">
                        Accéder à mon compte
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Lien brut -->
            <tr>
              <td align="center" style="padding:6px 28px 0;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#000000;">
                  Si le bouton ne s’affiche pas, copiez-collez :<br/>
                  <span style="color:#16A34A;">${loginUrl}</span>
                </p>
              </td>
            </tr>

            <!-- Séparateur -->
            <tr>
              <td style="padding:18px 28px 6px;">
                <hr style="border:none;border-top:1px solid #000000;margin:0;" />
              </td>
            </tr>

            <!-- Slogan -->
            <tr>
              <td align="center" style="padding:8px 28px;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#000000;">
                  <strong>Nous sommes partout et pour tous.</strong> <span style="letter-spacing:0.5px;">CASH HAY</span>
                </p>
              </td>
            </tr>

            <!-- Support -->
            <tr>
              <td align="center" style="padding:6px 28px 0;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#000000;">
                  Besoin d’aide ? Écrivez-nous à
                  <a href="mailto:support@cash-hay.com" style="color:#16A34A;text-decoration:none;">support@cash-hay.com</a>.
                </p>
              </td>
            </tr>

            <!-- Réseaux (badges verts) -->
            <tr>
              <td align="center" style="padding:16px 20px 24px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center" style="padding:0 6px;">
                      <a href="https://www.linkedin.com/company/cash-hay" target="_blank" rel="noopener"
                         style="display:inline-block;width:36px;height:36px;border-radius:18px;background:#16A34A;color:#FFFFFF;
                                font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:36px;text-align:center;text-decoration:none;">in</a>
                    </td>
                    <td align="center" style="padding:0 6px;">
                      <a href="https://x.com/cash_hay" target="_blank" rel="noopener"
                         style="display:inline-block;width:36px;height:36px;border-radius:18px;background:#16A34A;color:#FFFFFF;
                                font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:36px;text-align:center;text-decoration:none;">X</a>
                    </td>
                    <td align="center" style="padding:0 6px;">
                      <a href="https://www.instagram.com/cash_hay" target="_blank" rel="noopener"
                         style="display:inline-block;width:36px;height:36px;border-radius:18px;background:#16A34A;color:#FFFFFF;
                                font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:36px;text-align:center;text-decoration:none;">IG</a>
                    </td>
                    <td align="center" style="padding:0 6px;">
                      <a href="https://www.facebook.com/cashhay" target="_blank" rel="noopener"
                         style="display:inline-block;width:36px;height:36px;border-radius:18px;background:#16A34A;color:#FFFFFF;
                                font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:36px;text-align:center;text-decoration:none;">f</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#000000;">
                  © Cash Hay • Tous droits réservés
                </p>
              </td>
            </tr>
          </table>
          <!-- /Container -->
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}
