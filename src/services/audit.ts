import { Request } from 'express';
import pool from '../config/db';

export async function logAudit(userId: string, action: string, req?: Request, details?: any) {
  const ip =
    (req?.headers['x-forwarded-for'] as string) ||
    req?.socket?.remoteAddress ||
    null;
  const ua = (req?.headers['user-agent'] as string) || null;

  await pool.query(
    `INSERT INTO audit_logs (user_id, action, ip_address, user_agent, details)
     VALUES ($1,$2,$3,$4,$5)`,
    [userId, action, ip, ua, details ? JSON.stringify(details) : null]
  );
}
