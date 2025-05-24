import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'cashhay',
    password: 'Haitian@2025',
    port: 5432,
});
export default pool;
