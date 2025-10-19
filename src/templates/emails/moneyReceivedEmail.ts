// backend/src/templates/emails/moneyReceivedEmail.ts
import { deliverEmailWithLogo } from './_deliver';

export type MoneyReceivedEmailProps = {
  recipientFirstName?: string;
  senderFirstName?: string;
  amountLabel?: string;
  txRef?: string;
  createdAtLabel?: string;
  // compat ancien code
  loginUrl?: string;
  // nouvel alias
  appUrl?: string;
};

export function buildMoneyReceivedEmail({
  recipientFirstName = '',
  senderFirstName = 'un membre',
  amountLabel = '',
  txRef,
  createdAtLabel,
  loginUrl,
  appUrl,
}: MoneyReceivedEmailProps) {
  const subject = 'Transfert reçu - Cash Hay';
  const portalUrl =
    appUrl ||
    loginUrl ||
    process.env.APP_LOGIN_URL ||
    'https://app.cash-hay.com/login';

  const text = [
    `Bonjour ${recipientFirstName || ''},`,
    ``,
    `Vous avez reçu ${amountLabel} via Cash Hay de ${senderFirstName}.`,
    txRef ? `Référence: ${txRef}` : '',
    createdAtLabel ? `Date: ${createdAtLabel}` : '',
    ``,
    `Se connecter: ${portalUrl}`,
    ``,
    `Merci d’utiliser Cash Hay.`,
  ]
    .filter(Boolean)
    .join('\n');

  const html = `<!doctype html>
<html lang="fr" style="margin:0;padding:0;">
  <body style="margin:0;padding:0;background:#FFFFFF;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #000000;">
            <tr>
              <td align="center" style="padding:28px 24px 10px;">
                <img src="cid:cashhay_logo"
                     width="120" height="120" alt="Cash Hay"
                     style="display:block;width:120px;height:120px;border:0;outline:none;text-decoration:none;border-radius:12px;-ms-interpolation-mode:bicubic;" />
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:6px 24px 0;">
                <h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:30px;color:#000000;">
                  Félicitations&nbsp;! Vous avez reçu un transfert
                </h1>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:14px 28px 8px;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#000000;">
                  Bonjour ${recipientFirstName || ''},<br/>
                  Vous avez reçu <strong style="color:#16A34A;">${amountLabel}</strong> de <strong>${senderFirstName}</strong> sur Cash Hay.
                </p>
              </td>
            </tr>

            ${txRef || createdAtLabel ? `
            <tr>
              <td align="center" style="padding:8px 28px 0;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#000000;">
                  ${txRef ? `Référence&nbsp;: <strong>${txRef}</strong><br/>` : ''}
                  ${createdAtLabel ? `Date&nbsp;: <strong>${createdAtLabel}</strong>` : ''}
                </p>
              </td>
            </tr>` : ''}

            <tr>
              <td align="center" style="padding:14px 28px 0;">
                <a href="${portalUrl}" target="_blank" rel="noopener"
                   style="display:inline-block;background:#16A34A;color:#FFFFFF;border-radius:10px;padding:12px 20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;text-decoration:none;">
                  Se connecter
                </a>
              </td>
            </tr>

            <tr><td style="padding:18px 28px 6px;"><hr style="border:none;border-top:1px solid #000000;margin:0;" /></td></tr>

            <tr>
              <td align="center" style="padding:8px 28px;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:20px;color:#000000;">
                  Merci d’avoir rejoint la famille Cash Hay. Utilisez Cash Hay en respectant les lois et normes internationales.
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

/* ------------------------------------------------------------------ */
/* Envoi : helper dédié à ce template                                  */
/* ------------------------------------------------------------------ */

// Destinataire polymorphique : clair / id / enc / bidx
type Recipient =
  | { to: string }
  | { toUserId: string }
  | { toEmailEnc: string }
  | { toEmailBidx: string };

/**
 * Envoie l'email "Transfert reçu" avec le logo inline (cid:cashhay_logo).
 * Utilise SendGrid (via sendEmail) avec fallback SMTP si nécessaire.
 */
export async function sendMoneyReceivedEmail(
  recipient: Recipient,
  props: Parameters<typeof buildMoneyReceivedEmail>[0]
) {
  const built = buildMoneyReceivedEmail(props);
  return deliverEmailWithLogo(recipient, built);
}
