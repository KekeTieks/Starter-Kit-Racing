import { Router } from 'express';
import { query } from '../db/client.js';

const router = Router();

// Alphanumeric character set for ID generation (62 chars → 62^8 ≈ 218 trillion combos)
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function generateId() {

    let id = '';
    for ( let i = 0; i < 8; i++ ) id += CHARS[ Math.floor( Math.random() * CHARS.length ) ];
    return id;

}

// ── Default builtin circuit (Classic Loop) ──────────────────────────────────

const BUILTIN_CLASSIC = [
    [ -3, -3, 'track-corner',   16 ],
    [ -2, -3, 'track-straight', 22 ],
    [ -1, -3, 'track-straight', 22 ],
    [  0, -3, 'track-corner',    0 ],
    [ -3, -2, 'track-straight',  0 ],
    [  0, -2, 'track-straight',  0 ],
    [ -3, -1, 'track-corner',   10 ],
    [ -2, -1, 'track-corner',    0 ],
    [  0, -1, 'track-straight',  0 ],
    [ -2,  0, 'track-straight', 10 ],
    [  0,  0, 'track-finish',    0 ],
    [ -2,  1, 'track-straight', 10 ],
    [  0,  1, 'track-straight',  0 ],
    [ -2,  2, 'track-corner',   10 ],
    [ -1,  2, 'track-straight', 16 ],
    [  0,  2, 'track-corner',   22 ],
];

/** Ensure the builtin circuit exists in DB (called once at startup) */
/** Upsert the builtin circuit — leaves all custom circuits untouched. */
export async function seedBuiltinCircuits() {

    try {

        await query(
            `INSERT INTO circuits (id, name, cells, builtin)
             VALUES ($1, $2, $3, TRUE)
             ON CONFLICT (id) DO UPDATE
               SET name = EXCLUDED.name,
                   cells = EXCLUDED.cells,
                   builtin = TRUE`,
            [ 'CLASSIC0', 'Classic Loop', JSON.stringify( BUILTIN_CLASSIC ) ]
        );
        console.log( '[circuits] Builtin circuit seeded: Classic Loop' );

    } catch ( err ) {

        console.error( '[circuits] Failed to seed builtin:', err.message );

    }

}

/** GET /api/circuits — list circuits (builtins + player's own if ?username= provided) */
router.get( '/', async ( req, res ) => {

    const { username } = req.query;

    try {

        // Always return builtins
        let sql = `SELECT id, name, cells, builtin, created_at, updated_at
                   FROM circuits WHERE builtin = TRUE
                   ORDER BY created_at ASC`;
        const builtins = await query( sql );

        let custom = { rows: [] };

        if ( username ) {

            custom = await query(
                `SELECT c.id, c.name, c.cells, c.builtin, c.created_at, c.updated_at
                 FROM circuits c
                 JOIN players p ON p.id = c.player_id
                 WHERE p.username = $1 AND c.builtin = FALSE
                 ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC`,
                [ username ]
            );

        }

        const circuits = [ ...builtins.rows, ...custom.rows ];
        res.json( { circuits } );

    } catch ( err ) {

        console.error( '[circuits] GET list error:', err );
        res.status( 500 ).json( { error: 'Internal server error' } );

    }

} );

/** POST /api/circuits  { cells, name?, username? } → { circuit } */
router.post( '/', async ( req, res ) => {

    const { cells, name, username } = req.body;

    if ( ! Array.isArray( cells ) || cells.length === 0 ) {

        return res.status( 400 ).json( { error: 'cells array required' } );

    }

    try {

        // Resolve player_id from username if provided
        let playerId = null;

        if ( username ) {

            const pResult = await query( 'SELECT id FROM players WHERE username = $1', [ username ] );
            if ( pResult.rows.length > 0 ) playerId = pResult.rows[ 0 ].id;

        }

        // Generate a unique ID (retry on collision — extremely unlikely)
        let id;
        let attempts = 0;

        do {

            id = generateId();
            const existing = await query( 'SELECT id FROM circuits WHERE id = $1', [ id ] );
            if ( existing.rows.length === 0 ) break;
            attempts++;

        } while ( attempts < 5 );

        await query(
            'INSERT INTO circuits (id, name, cells, player_id) VALUES ($1, $2, $3, $4)',
            [ id, name || null, JSON.stringify( cells ), playerId ]
        );

        const result = await query(
            'SELECT id, name, cells, builtin, created_at, updated_at FROM circuits WHERE id = $1',
            [ id ]
        );

        res.status( 201 ).json( { circuit: result.rows[ 0 ] } );

    } catch ( err ) {

        console.error( '[circuits] POST error:', err );
        res.status( 500 ).json( { error: 'Internal server error' } );

    }

} );

/** GET /api/circuits/:id → { cells, name?, ... } */
router.get( '/:id', async ( req, res ) => {

    const { id } = req.params;

    if ( ! /^[A-Za-z0-9]{1,8}$/.test( id ) ) {

        return res.status( 400 ).json( { error: 'Invalid circuit ID' } );

    }

    try {

        const result = await query(
            'SELECT id, name, cells, builtin, created_at, updated_at FROM circuits WHERE id = $1',
            [ id ]
        );

        if ( result.rows.length === 0 ) {

            return res.status( 404 ).json( { error: 'Circuit not found' } );

        }

        res.json( result.rows[ 0 ] );

    } catch ( err ) {

        console.error( '[circuits] GET error:', err );
        res.status( 500 ).json( { error: 'Internal server error' } );

    }

} );

/** PUT /api/circuits/:id  { cells, name?, username } → { circuit } */
router.put( '/:id', async ( req, res ) => {

    const { id } = req.params;
    const { cells, name, username } = req.body;

    if ( ! /^[A-Za-z0-9]{1,8}$/.test( id ) ) {

        return res.status( 400 ).json( { error: 'Invalid circuit ID' } );

    }

    if ( ! username ) {

        return res.status( 400 ).json( { error: 'username required' } );

    }

    try {

        // Verify ownership
        const existing = await query(
            `SELECT c.id, c.builtin FROM circuits c
             JOIN players p ON p.id = c.player_id
             WHERE c.id = $1 AND p.username = $2`,
            [ id, username ]
        );

        if ( existing.rows.length === 0 ) {

            return res.status( 403 ).json( { error: 'Circuit not found or not owned by you' } );

        }

        if ( existing.rows[ 0 ].builtin ) {

            return res.status( 403 ).json( { error: 'Cannot modify builtin circuits' } );

        }

        const updates = [];
        const params = [];
        let idx = 1;

        if ( cells ) {

            updates.push( `cells = $${ idx++ }` );
            params.push( JSON.stringify( cells ) );

        }

        if ( name !== undefined ) {

            updates.push( `name = $${ idx++ }` );
            params.push( name );

        }

        updates.push( `updated_at = NOW()` );
        params.push( id );

        await query(
            `UPDATE circuits SET ${ updates.join( ', ' ) } WHERE id = $${ idx }`,
            params
        );

        const result = await query(
            'SELECT id, name, cells, builtin, created_at, updated_at FROM circuits WHERE id = $1',
            [ id ]
        );

        res.json( { circuit: result.rows[ 0 ] } );

    } catch ( err ) {

        console.error( '[circuits] PUT error:', err );
        res.status( 500 ).json( { error: 'Internal server error' } );

    }

} );

/** DELETE /api/circuits/:id?username=xxx */
router.delete( '/:id', async ( req, res ) => {

    const { id } = req.params;
    const { username } = req.query;

    if ( ! /^[A-Za-z0-9]{1,8}$/.test( id ) ) {

        return res.status( 400 ).json( { error: 'Invalid circuit ID' } );

    }

    if ( ! username ) {

        return res.status( 400 ).json( { error: 'username required' } );

    }

    try {

        // Verify ownership and not builtin
        const existing = await query(
            `SELECT c.id, c.builtin FROM circuits c
             JOIN players p ON p.id = c.player_id
             WHERE c.id = $1 AND p.username = $2`,
            [ id, username ]
        );

        if ( existing.rows.length === 0 ) {

            return res.status( 403 ).json( { error: 'Circuit not found or not owned by you' } );

        }

        if ( existing.rows[ 0 ].builtin ) {

            return res.status( 403 ).json( { error: 'Cannot delete builtin circuits' } );

        }

        await query( 'DELETE FROM circuits WHERE id = $1', [ id ] );
        res.json( { ok: true } );

    } catch ( err ) {

        console.error( '[circuits] DELETE error:', err );
        res.status( 500 ).json( { error: 'Internal server error' } );

    }

} );

export default router;
