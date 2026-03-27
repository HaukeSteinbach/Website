import pg from 'pg';

import { config } from './config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl || undefined
});

export async function query(text, params = []) {
  if (!config.databaseUrl) {
    return { rows: [], rowCount: 0, command: 'NO_DB' };
  }

  return pool.query(text, params);
}
