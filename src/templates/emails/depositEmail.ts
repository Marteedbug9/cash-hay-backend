// backend/src/templates/emails/depositEmail.ts
export function buildDepositEmail({
  firstName = '',
  amountLabel = '0 HTG',
  balanceAfterLabel = '',
  txRef = '',
  loginUrl = process.env.APP_LOGIN_URL || 'https://app.cash-hay.com/login',
}: {
  firstName?: string;
  amountLabel?: string;
  balanceAfterLabel?: string; // optionnel
  txRef?: string;             // optionnel
  loginUrl?: string;
}) {
  const subject = 'Dépôt confirmé - Cash Hay';

  const text =
`Bonjour ${firstName || ''},

Votre dépôt de ${amountLabel} a bien été crédité sur votre compte Cash Hay.${balanceAfterLabel ? ` Nouveau solde : ${balanceAfterLabel}.` : ''}${txRef ? `\nRéférence : ${txRef}` : ''}

Merci d’avoir choisi CASH HAY. En respectant les lois, nos termes et conditions, vous serez toujours le bienvenu dans la famille. Votre argent est protégé, disponible et utilisable partout dans le monde.

Se connecter : ${loginUrl}
Support : support@cash-hay.com
Suivez-nous : LinkedIn / X / Instagram / Facebook
© Cash Hay – Tous droits réservés`;

  const html = `<!doctype html>
<html lang="fr" style="margin:0;padding:0;">
  <body style="margin:0;padding:0;background:#FFFFFF;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #000000;">
            <tr>
              <td align="center" style="padding:28px 24px 10px;">
                <img src="https://res.cloudinary.com/dmwcxkzs3/image/upload/v1755125913/ChatGPT_Image_Jul_27_2025_01_38_46_PM_qsxzai.png"
                     width="120" height="120" alt="Cash Hay"
                     style="display:block;width:120px;height:120px;border:0;outline:none;text-decoration:none;border-radius:12px" />
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:6px 24px 0;">
                <h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:30px;color:#000000;">
                  Dépôt confirmé
                </h1>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:12px 28px 6px;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:#000000;">
                  Bonjour${firstName ? ' <strong>' + firstName + '</strong>' : ''}, votre dépôt de
                  <strong>${amountLabel}</strong> a bien été crédité sur votre compte Cash Hay.
                  ${balanceAfterLabel ? `<br/>Nouveau solde : <strong>${balanceAfterLabel}</strong>.` : ''}
                  ${txRef ? `<br/>Référence : <strong>${txRef}</strong>.` : ''}
                </p>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:10px 28px 0;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;color:#000000;">
                  Merci d’avoir choisi <strong>CASH HAY</strong>. En respectant les lois, nos
                  <em>termes et conditions</em>, vous serez toujours le bienvenu dans la famille.
                  Votre argent est <strong>protégé</strong>, <strong>disponible</strong> et
                  <strong>utilisable partout dans le monde</strong>.
                </p>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:18px 28px 8px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td bgcolor="#16A34A" style="border-radius:10px;">
                      <a href="${loginUrl}"
                         style="display:inline-block;padding:12px 22px;font-family:Arial,Helvetica,sans-serif;font-size:16px;color:#FFFFFF;text-decoration:none;border-radius:10px;"
                         target="_blank" rel="noopener">
                        Ouvrir mon compte
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:6px 28px 0;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#000000;">
                  Si le bouton ne s’affiche pas, copiez-collez :<br/>
                  <span style="color:#16A34A;">${loginUrl}</span>
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:18px 28px 6px;">
                <hr style="border:none;border-top:1px solid #000000;margin:0;" />
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:8px 28px;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#000000;">
                  Besoin d’aide ? Écrivez-nous à
                  <a href="mailto:support@cash-hay.com" style="color:#16A34A;text-decoration:none;">support@cash-hay.com</a>.
                </p>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:16px 20px 24px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center" style="padding:0 6px;">
                      <a href="https://www.linkedin.com/company/cash-hay" target="_blank" rel="noopener"
                         style="display:inline-block;width:36px;height:36px;border-radius:18px;background:#16A34A;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:36px;text-align:center;text-decoration:none;">in</a>
                    </td>
                    <td align="center" style="padding:0 6px;">
                      <a href="https://x.com/cash_hay" target="_blank" rel="noopener"
                         style="display:inline-block;width:36px;height:36px;border-radius:18px;background:#16A34A;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:36px;text-align:center;text-decoration:none;">X</a>
                    </td>
                    <td align="center" style="padding:0 6px;">
                      <a href="https://www.instagram.com/cash_hay" target="_blank" rel="noopener"
                         style="display:inline-block;width:36px;height:36px;border-radius:18px;background:#16A34A;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:36px;text-align:center;text-decoration:none;">IG</a>
                    </td>
                    <td align="center" style="padding:0 6px;">
                      <a href="https://www.facebook.com/cashhay" target="_blank" rel="noopener"
                         style="display:inline-block;width:36px;height:36px;border-radius:18px;background:#16A34A;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:36px;text-align:center;text-decoration:none;">f</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#000000;">
                  © Cash Hay • Tous droits réservés
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}
