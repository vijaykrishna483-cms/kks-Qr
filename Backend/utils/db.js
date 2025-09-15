import pkg from 'pg';
const { Pool } = pkg;

export const pool = new Pool({
  connectionString: "postgresql://kksadmin:FROTNe4FMVJvDU1SrUuMtlRbxe2cTc0M@dpg-d340kpruibrs73b0a5ng-a.oregon-postgres.render.com/kksdb",
  ssl: { rejectUnauthorized: false }   // ✅ add this
});
