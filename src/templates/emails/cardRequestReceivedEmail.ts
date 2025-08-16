// backend/src/templates/emails/cardRequestReceivedEmail.ts
export function buildCardRequestReceivedEmail({
  firstName = '',
  styleLabel = '',
  requestId = '',
  statusUrl = process.env.APP_LOGIN_URL
    ? `${process.env.APP_LOGIN_URL}/cards/status`
    : 'https://app.cash-hay.com/cards/status',
  loginUrl = process.env.APP_LOGIN_URL || 'https://app.cash-hay.com/login',
}: {
  firstName?: string;
  styleLabel?: string;   // ex: "Classique Noir" (optionnel)
  requestId?: string;    // ex: numéro/ID de demande (optionnel)
  statusUrl?: string;    // lien vers le suivi de la demande
  loginUrl?: string;     // lien générique vers l'app
}) {
  const subject = 'Demande de carte physique reçue – Cash Hay';

  const text =
`Bonjour ${firstName || ''},

Nous avons bien reçu votre demande de carte physique Cash Hay.${styleLabel ? ` Modèle choisi : ${styleLabel}.` : ''}${requestId ? `\nRéférence de demande : ${requestId}.` : ''}

Vous pouvez vérifier à tout moment le statut de votre demande :
${statusUrl}

Merci d’avoir choisi CASH HAY. Utilisez votre compte partout, facilement et en sécurité, dans le respect des lois et de nos conditions.

Ouvrir mon compte : ${loginUrl}
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
                  Demande de carte physique reçue
                </h1>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:12px 28px 6px;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:#000000;">
                  Bonjour${firstName ? ' <strong>' + firstName + '</strong>' : ''}, nous avons bien reçu votre demande de carte physique Cash Hay.
                  ${styleLabel ? `<br/>Modèle choisi : <strong>${styleLabel}</strong>.` : ''}
                  ${requestId ? `<br/>Référence de demande : <strong>${requestId}</strong>.` : ''}
                </p>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:10px 28px 0;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;color:#000000;">
                  Merci d’avoir choisi <strong>CASH HAY</strong>. Vérifiez à tout moment le
                  <strong>statut</strong> de votre demande et suivez son avancement.
                  Utilisez votre compte <strong>partout</strong>, facilement et en <strong>sécurité</strong>,
                  dans le respect des lois et de nos <em>termes et conditions</em>.
                </p>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:18px 28px 8px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td bgcolor="#16A34A" style="border-radius:10px;">
                      <a href="${statusUrl}"
                         style="display:inline-block;padding:12px 22px;font-family:Arial,Helvetica,sans-serif;font-size:16px;color:#FFFFFF;text-decoration:none;border-radius:10px;"
                         target="_blank" rel="noopener">
                        Vérifier le statut
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
                  <span style="color:#16A34A;">${statusUrl}</span>
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
                  Ouvrir mon compte :
                  <a href="${loginUrl}" style="color:#16A34A;text-decoration:none;">${loginUrl}</a><br/>
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
