import pg from 'pg';

const { Pool } = pg;

// DATABASE_URL set by docker-compose, fallback for local dev without Docker
const pool = new Pool( {
    connectionString: process.env.DATABASE_URL || 'postgres://myrace:myrace_secret@localhost:5432/myrace',
    max:              10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
} );

pool.on( 'error', ( err ) => {

    console.error( '[db] Unexpected pool error:', err.message );

} );

export async function query( sql, params ) {

    const client = await pool.connect();
    try {

        return await client.query( sql, params );

    } finally {

        client.release();

    }

}

export async function getClient() {

    return pool.connect();

}

export default pool;
