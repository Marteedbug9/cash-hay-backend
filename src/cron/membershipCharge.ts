import pool from '../config/db';

const MEMBERSHIP_FEE = 25;

const runMembershipCharge = async () => {
  const client = await pool.connect();

  try {
    // Sélectionne cartes actives, non prélevées, demandées il y a +48h
    const res = await client.query(`
      SELECT c.id AS card_id, c.user_id, b.amount as balance
      FROM cards c
      JOIN balances b ON c.user_id = b.user_id
      WHERE c.status = 'active'
        AND (c.charged IS NULL OR c.charged = false)
        AND c.requested_at <= NOW() - INTERVAL '48 hours'
    `);

    for (const card of res.rows) {
      if (parseFloat(card.balance) < MEMBERSHIP_FEE) {
        console.log(`Utilisateur ${card.user_id} n'a pas assez de solde.`);
        continue;
      }

      await client.query('BEGIN');

      // Débiter l’utilisateur
      await client.query(
        'UPDATE balances SET amount = amount - $1 WHERE user_id = $2',
        [MEMBERSHIP_FEE, card.user_id]
      );

      // Créditer l’admin
      const adminRes = await client.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
      const adminId = adminRes.rows[0]?.id;
      if (adminId) {
        await client.query(
          'UPDATE balances SET amount = amount + $1 WHERE user_id = $2',
          [MEMBERSHIP_FEE, adminId]
        );
      }

      // Historique de transaction pour l’utilisateur
      await client.query(`
        INSERT INTO transactions(user_id, amount, currency, type, description, status, created_at)
        VALUES ($1, $2, 'HTG', 'membership', $3, 'completed', NOW())
      `, [card.user_id, MEMBERSHIP_FEE, '25 HTG pour membership card début par Cash Hay']);

      // Marquer la carte comme débitée
      await client.query(
        'UPDATE cards SET charged = true WHERE id = $1',
        [card.card_id]
      );

      await client.query('COMMIT');
      console.log(`✅ 25 HTG prélevés pour la carte ${card.card_id} (user ${card.user_id})`);
    }

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur lors du traitement des cartes :', error);
  } finally {
    client.release();
  }
};

runMembershipCharge();
