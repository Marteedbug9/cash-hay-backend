export type MoneySentEmailProps = {
  senderFirstName?: string;
  recipientFirstName?: string;
  recipientLabel?: string;
  amountLabel?: string;
  feeLabel?: string;
  totalLabel?: string;
  txRef?: string;
  createdAtLabel?: string;
  loginUrl?: string;
  appUrl?: string;
};

export function buildMoneySentEmail({
  senderFirstName = '',
  recipientFirstName = '',
  recipientLabel = '',
  amountLabel = '',
  feeLabel,
  totalLabel,
  txRef,
  createdAtLabel,
  loginUrl,
  appUrl,
}: MoneySentEmailProps) {
  const subject = 'Votre transfert est confirmé - Cash Hay';
  const portalUrl = appUrl || loginUrl || process.env.APP_LOGIN_URL || 'https://app.cash-hay.com/login';

  const text = [
    `Bonjour ${senderFirstName || ''},`,
    ``,
    `Votre envoi de ${amountLabel} à ${recipientLabel || recipientFirstName || 'le destinataire'} est confirmé.`,
    feeLabel ? `Frais: ${feeLabel}` : '',
    totalLabel ? `Total débité: ${totalLabel}` : '',
    txRef ? `Référence: ${txRef}` : '',
    createdAtLabel ? `Date: ${createdAtLabel}` : '',
    ``,
    `Suivre mes opérations: ${portalUrl}`,
  ].filter(Boolean).join('\n');

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
                  Envoi confirmé
                </h1>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:14px 28px 8px;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#000000;">
                  Bonjour ${senderFirstName || ''},<br/>
                  Vous avez envoyé <strong style="color:#16A34A;">${amountLabel}</strong> à <strong>${recipientLabel || recipientFirstName || 'le destinataire'}</strong>.
                </p>
              </td>
            </tr>

            ${(feeLabel || totalLabel || txRef || createdAtLabel) ? `
            <tr>
              <td align="center" style="padding:8px 28px 0;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#000000;">
                  ${feeLabel ? `Frais&nbsp;: <strong>${feeLabel}</strong><br/>` : ''}
                  ${totalLabel ? `Total débité&nbsp;: <strong>${totalLabel}</strong><br/>` : ''}
                  ${txRef ? `Référence&nbsp;: <strong>${txRef}</strong><br/>` : ''}
                  ${createdAtLabel ? `Date&nbsp;: <strong>${createdAtLabel}</strong>` : ''}
                </p>
              </td>
            </tr>` : ''}

            <tr>
              <td align="center" style="padding:18px 28px 8px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td bgcolor="#16A34A" style="border-radius:10px;">
                      <a href="${portalUrl}"
                         style="display:inline-block;padding:12px 22px;font-family:Arial,Helvetica,sans-serif;font-size:16px;color:#FFFFFF;text-decoration:none;border-radius:10px;"
                         target="_blank" rel="noopener">
                        Suivre mes opérations
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr><td style="padding:18px 28px 6px;"><hr style="border:none;border-top:1px solid #000000;margin:0;" /></td></tr>

            <tr>
              <td align="center" style="padding:8px 28px;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:20px;color:#000000;">
                  Merci d’utiliser Cash Hay. Votre solde est protégé par des normes internationales.
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
