import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();
export const pool = new Pool({
  connectionString: process.env.DB_URL,
  ssl: process.env.DB_URL && process.env.DB_URL.includes('localhost') 
    ? false 
    : { rejectUnauthorized: false }
});
