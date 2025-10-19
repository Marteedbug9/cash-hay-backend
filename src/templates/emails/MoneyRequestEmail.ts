export type MoneyRequestEmailProps = {
  // Rôles
  requesterFirstName?: string;   // celui qui demande l'argent (émetteur de la demande)
  recipientFirstName?: string;   // celui qui doit payer (destinataire de la demande)

  // Libellés & infos
  requesterLabel?: string;       // nom/alias à afficher pour le demandeur
  amountLabel?: string;          // "1 250 HTG"
  noteLabel?: string;            // note facultative "Pour le dîner"
  dueDateLabel?: string;         // "Échéance : 12/11/2025"
  feeLabel?: string;             // optionnel si vous facturez une commission
  requestRef?: string;           // référence interne de la demande
  createdAtLabel?: string;       // date de création "10/17/2025 14:22"
  loginUrl?: string;             // portail web
  appUrl?: string;               // URL app / deep-link "cashhay://..."
  payUrl?: string;               // lien de paiement direct (pour le destinataire)

  // Vue
  variant?: 'received' | 'sent'; // défaut: 'received'
};

export function buildMoneyRequestEmail({
  requesterFirstName = '',
  recipientFirstName = '',
  requesterLabel = '',
  amountLabel = '',
  noteLabel,
  dueDateLabel,
  feeLabel,
  requestRef,
  createdAtLabel,
  loginUrl,
  appUrl,
  payUrl,
  variant = 'received',
}: MoneyRequestEmailProps) {
  const isReceived = variant === 'received';

  const portalUrl =
    appUrl || loginUrl || process.env.APP_LOGIN_URL || 'https://app.cash-hay.com/login';

  const subject = isReceived
    ? 'Vous avez reçu une demande d’argent - Cash Hay'
    : 'Votre demande d’argent a été envoyée - Cash Hay';

  const introLine = isReceived
    ? `Bonjour ${recipientFirstName || ''},`
    : `Bonjour ${requesterFirstName || ''},`;

  const bodyLine = isReceived
    ? `Vous avez reçu une demande de <strong style="color:#16A34A;">${amountLabel}</strong> de la part de <strong>${requesterLabel || requesterFirstName || 'l’émetteur'}</strong>.`
    : `Votre demande de <strong style="color:#16A34A;">${amountLabel}</strong> à <strong>${recipientFirstName || 'le destinataire'}</strong> a bien été envoyée.`;

  // ---- TEXT (plain) ----
  const textParts = [
    `${introLine}`,
    ``,
    isReceived
      ? `Vous avez reçu une demande de ${amountLabel} de la part de ${requesterLabel || requesterFirstName || 'l’émetteur'}.`
      : `Votre demande de ${amountLabel} à ${recipientFirstName || 'le destinataire'} a été envoyée.`,
    noteLabel ? `Note : ${noteLabel}` : '',
    dueDateLabel ? `${dueDateLabel}` : '',
    feeLabel ? `Frais : ${feeLabel}` : '',
    requestRef ? `Référence : ${requestRef}` : '',
    createdAtLabel ? `Date : ${createdAtLabel}` : '',
    '',
    isReceived && (payUrl || portalUrl)
      ? `Payer maintenant : ${payUrl || portalUrl}`
      : `Ouvrir l’application : ${portalUrl}`,
  ].filter(Boolean);

  const text = textParts.join('\n');

  // ---- HTML ----
  const ctaHtml = isReceived && (payUrl || portalUrl)
    ? `
      <tr>
        <td align="center" style="padding:16px 28px 6px;">
          <a href="${payUrl || portalUrl}" target="_blank" rel="noopener"
             style="display:inline-block;background:#16A34A;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;
                    font-size:15px;line-height:20px;text-decoration:none;padding:12px 20px;border-radius:10px;">
            Payer maintenant
          </a>
        </td>
      </tr>
    `
    : `
      <tr>
        <td align="center" style="padding:16px 28px 6px;">
          <a href="${portalUrl}" target="_blank" rel="noopener"
             style="display:inline-block;background:#16A34A;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;
                    font-size:15px;line-height:20px;text-decoration:none;padding:12px 20px;border-radius:10px;">
            Ouvrir Cash Hay
          </a>
        </td>
      </tr>
    `;

  const detailsHtml =
    (noteLabel || dueDateLabel || feeLabel || requestRef || createdAtLabel)
      ? `
      <tr>
        <td align="center" style="padding:8px 28px 0;">
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#000000;">
            ${noteLabel ? `Note&nbsp;: <strong>${noteLabel}</strong><br/>` : ''}
            ${dueDateLabel ? `${dueDateLabel}<br/>` : ''}
            ${feeLabel ? `Frais&nbsp;: <strong>${feeLabel}</strong><br/>` : ''}
            ${requestRef ? `Référence&nbsp;: <strong>${requestRef}</strong><br/>` : ''}
            ${createdAtLabel ? `Date&nbsp;: <strong>${createdAtLabel}</strong>` : ''}
          </p>
        </td>
      </tr>`
      : '';

  const heading = isReceived ? 'Demande d’argent reçue' : 'Demande d’argent envoyée';

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
                  ${heading}
                </h1>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:14px 28px 8px;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#000000;">
                  ${introLine}<br/>
                  ${bodyLine}
                </p>
              </td>
            </tr>

            ${detailsHtml}
            ${ctaHtml}

            <tr><td style="padding:18px 28px 6px;"><hr style="border:none;border-top:1px solid #000000;margin:0;" /></td></tr>

            <tr>
              <td align="center" style="padding:8px 28px;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:20px;color:#000000;">
                  Merci d’utiliser Cash Hay. Vos paiements sont protégés par des normes internationales.
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
