// backend/src/utils/backfillNotificationsEnc.ts
import pool from '../config/db';
import { encrypt, blindIndexEmail, blindIndexPhone } from './crypto';

function looksEmail(v: string) { return /\S+@\S+\.\S+/.test(v); }
function looksPhone(v: string) { return /^[0-9+\-\s()]{6,}$/.test(v); }

async function main() {
  console.log('▶ backfill notifications *_enc ...');

  const { rows } = await pool.query(`
    SELECT id, from_first_name, from_last_name, from_contact, from_profile_image
    FROM notifications
    WHERE from_first_name_enc IS NULL
       OR from_last_name_enc  IS NULL
       OR from_contact_enc    IS NULL
       OR from_profile_image_enc IS NULL
       OR from_contact_email_bidx IS NULL
       OR from_contact_phone_bidx IS NULL
  `);

  console.log(`À traiter: ${rows.length} lignes`);

  for (const r of rows) {
    const first     = r.from_first_name || '';
    const last      = r.from_last_name  || '';
    const contact   = r.from_contact    || '';
    const profile   = r.from_profile_image || '';

    const firstEnc   = encrypt(first);
    const lastEnc    = encrypt(last);
    const contactEnc = encrypt(contact);
    const profileEnc = encrypt(profile);

    const emailBidx = looksEmail(contact) ? blindIndexEmail(contact) : null;
    const phoneBidx = looksPhone(contact) ? blindIndexPhone(contact) : null;

    await pool.query(
      `
      UPDATE notifications
         SET from_first_name_enc = $1,
             from_last_name_enc  = $2,
             from_contact_enc    = $3,
             from_profile_image_enc = $4,
             from_contact_email_bidx = COALESCE($5, from_contact_email_bidx),
             from_contact_phone_bidx = COALESCE($6, from_contact_phone_bidx)
       WHERE id = $7
      `,
      [firstEnc, lastEnc, contactEnc, profileEnc, emailBidx, phoneBidx, r.id]
    );
  }

  console.log('✅ backfill terminé.');
  await pool.end();
}

main().catch(e => {
  console.error('❌ backfill failed:', e);
  process.exit(1);
});
