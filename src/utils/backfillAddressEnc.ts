// src/utils/backfillAddressEnc.ts
import 'dotenv/config';
import pool from '../config/db';
import { encrypt } from './crypto';

type Row = { id: string; address: string | null; address_enc: string | null };

// Usage: ts-node src/utils/backfillAddressEnc.ts [LIMIT]
// Exemples :
//   BACKFILL_DRY_RUN=1 npx ts-node src/utils/backfillAddressEnc.ts 50
//   npx ts-node src/utils/backfillAddressEnc.ts 500
const LIMIT = Number(process.argv[2]) || 500;
const DRY_RUN = process.env.BACKFILL_DRY_RUN === '1';

(async () => {
  const client = await pool.connect();
  try {
    console.log(`▶ backfill address_enc (limit=${LIMIT}, dry_run=${DRY_RUN ? 'ON' : 'OFF'})`);

    const { rows } = await client.query<Row>(
      `SELECT id, address, address_enc
       FROM users
       WHERE address IS NOT NULL
         AND (address_enc IS NULL OR address_enc = '')
       ORDER BY created_at ASC
       LIMIT $1`,
      [LIMIT]
    );

    console.log(`• lignes à mettre à jour : ${rows.length}`);

    let updated = 0;
    let skipped = 0;

    for (const r of rows) {
      if (!r.address) {
        skipped++;
        continue;
      }

      const enc = encrypt(r.address);

      if (DRY_RUN) {
        console.log(`- (dry-run) would UPDATE users SET address_enc = <enc> WHERE id = ${r.id}`);
      } else {
        await client.query(
          `UPDATE users SET address_enc = $1 WHERE id = $2`,
          [enc, r.id]
        );
      }
      updated++;
    }

    console.log(`✅ terminé : updated=${updated}, skipped=${skipped}, dry_run=${DRY_RUN}`);
  } catch (err) {
    console.error('❌ backfill échoué :', err);
    process.exitCode = 1;
  } finally {
    client.release();
  }
})();
