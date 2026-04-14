import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const { Pool } = pg

const connectionString = process.env.DATABASE_URL?.trim()

/**
 * Render Postgres (y la mayoría de hosts en la nube) entregan `DATABASE_URL`.
 * Local: suele usarse DB_USER, DB_HOST, etc. sin SSL.
 */
function createPool() {
  if (connectionString) {
    const sslOff = process.env.DB_SSL === 'false'
    const ssl = sslOff ? false : { rejectUnauthorized: false }
    return new Pool({ connectionString, ssl })
  }
  return new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT || 5432),
  })
}

export const pool = createPool()
