import { query } from './client.js';

/**
 * XP required to reach level n (from level n-1).
 * xp_for_level(n) = floor(100 * n^1.5)
 * Cumulative XP to reach level n: sum of xp_for_level(1..n)
 *
 * Level 1  →   100 XP
 * Level 5  →   558 XP cumulative
 * Level 10 →  2338 XP cumulative
 * Level 20 →  9665 XP cumulative
 * Level 50 → 36_084 XP cumulative
 */

const MIGRATIONS = [

    // ── 001: core tables ─────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS players (
        id            SERIAL PRIMARY KEY,
        username      VARCHAR(20) UNIQUE NOT NULL,
        password_hash VARCHAR(255),           -- null until auth is required
        created_at    TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS player_stats (
        player_id     INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
        level         INTEGER NOT NULL DEFAULT 1,
        xp            INTEGER NOT NULL DEFAULT 0,      -- total accumulated XP
        xp_this_level INTEGER NOT NULL DEFAULT 0,      -- XP progress within current level
        credits       INTEGER NOT NULL DEFAULT 0,
        races_played  INTEGER NOT NULL DEFAULT 0,
        wins          INTEGER NOT NULL DEFAULT 0,
        updated_at    TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS race_results (
        id            SERIAL PRIMARY KEY,
        player_id     INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        rank          INTEGER NOT NULL,           -- 1-based finish position
        players_count INTEGER NOT NULL,           -- total players in that race
        xp_earned     INTEGER NOT NULL DEFAULT 0,
        credits_earned INTEGER NOT NULL DEFAULT 0,
        played_at     TIMESTAMPTZ DEFAULT NOW()
    )`,

    // ── 002: indexes ──────────────────────────────────────────────────────────
    `CREATE INDEX IF NOT EXISTS idx_race_results_player ON race_results(player_id)`,
    `CREATE INDEX IF NOT EXISTS idx_race_results_played_at ON race_results(played_at DESC)`,

];

export async function migrate() {

    console.log( '[db] Running migrations...' );

    for ( const sql of MIGRATIONS ) {

        await query( sql );

    }

    console.log( '[db] Migrations complete.' );

}
