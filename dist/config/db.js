"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config(); // <-- doit être AVANT tout
const pg_1 = require("pg");
console.log('🔎 DATABASE_URL utilisée :', process.env.DATABASE_URL);
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false, // ✅ SSL que pour Render
});
exports.default = pool;
