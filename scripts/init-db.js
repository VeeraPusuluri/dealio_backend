/**
 * init-db.js
 * Creates the 'dealio' database on the PostgreSQL server if it doesn't exist.
 * Uses explicit connection params to avoid URL-parsing issues with
 * special characters in passwords.
 */
const { Client } = require('pg');

async function main() {
  // Parse connection details from DATABASE_URL using regex
  // Format: postgresql://user:password@host:port/dbname?params
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL is not set');

  const match = dbUrl.match(
    /^postgresql:\/\/([^:]+):(.+)@([^:\/]+):?(\d+)?\/[^?]+(.*)?$/
  );
  if (!match) throw new Error(`Cannot parse DATABASE_URL: ${dbUrl}`);

  const [, user, password, host, port] = match;
  const decodedPassword = decodeURIComponent(password);

  const client = new Client({
    host,
    port: parseInt(port || '5432', 10),
    user,
    password: decodedPassword,
    database: 'postgres', // connect to default db to create 'dealio'
    ssl: { rejectUnauthorized: false }, // managed Postgres (e.g. RDS) requires SSL
  });

  try {
    await client.connect();
    console.log(`Connected to Postgres at ${host} as ${user}`);

    const res = await client.query(
      `SELECT 1 FROM pg_database WHERE datname = 'dealio'`
    );

    if (res.rowCount === 0) {
      await client.query('CREATE DATABASE dealio');
      console.log('✅ Created database: dealio');
    } else {
      console.log('ℹ️  Database dealio already exists');
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('❌ init-db failed:', err.message);
  process.exit(1);
});
