/**
 * init-db.js
 * Creates the database named in DATABASE_URL on the PostgreSQL server if it doesn't exist.
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
    /^postgresql:\/\/([^:]+):(.+)@([^:\/]+):?(\d+)?\/([^?]+)(.*)?$/
  );
  if (!match) throw new Error(`Cannot parse DATABASE_URL: ${dbUrl}`);

  const [, user, password, host, port, dbName] = match;
  const decodedPassword = decodeURIComponent(password);

  // Only allow a safe identifier since CREATE DATABASE can't be parameterized.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(dbName)) {
    throw new Error(`Unsafe database name in DATABASE_URL: ${dbName}`);
  }

  const client = new Client({
    host,
    port: parseInt(port || '5432', 10),
    user,
    password: decodedPassword,
    database: 'postgres', // connect to default db to create the target db
    ssl: { rejectUnauthorized: false }, // managed Postgres (e.g. RDS) requires SSL
  });

  try {
    await client.connect();
    console.log(`Connected to Postgres at ${host} as ${user}`);

    const res = await client.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [dbName]
    );

    if (res.rowCount === 0) {
      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log(`✅ Created database: ${dbName}`);
    } else {
      console.log(`ℹ️  Database ${dbName} already exists`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('❌ init-db failed:', err.message);
  process.exit(1);
});
