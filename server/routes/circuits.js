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

/** POST /api/circuits  { cells: [...] } → { id: 'XXXXXXXX' } */
router.post( '/', async ( req, res ) => {

    const { cells } = req.body;

    if ( ! Array.isArray( cells ) || cells.length === 0 ) {

        return res.status( 400 ).json( { error: 'cells array required' } );

    }

    try {

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
            'INSERT INTO circuits (id, cells) VALUES ($1, $2)',
            [ id, JSON.stringify( cells ) ]
        );

        res.json( { id } );

    } catch ( err ) {

        console.error( '[circuits] POST error:', err );
        res.status( 500 ).json( { error: 'Internal server error' } );

    }

} );

/** GET /api/circuits/:id → { cells: [...] } */
router.get( '/:id', async ( req, res ) => {

    const { id } = req.params;

    if ( ! /^[A-Za-z0-9]{8}$/.test( id ) ) {

        return res.status( 400 ).json( { error: 'Invalid circuit ID' } );

    }

    try {

        const result = await query( 'SELECT cells FROM circuits WHERE id = $1', [ id ] );

        if ( result.rows.length === 0 ) {

            return res.status( 404 ).json( { error: 'Circuit not found' } );

        }

        res.json( { cells: result.rows[ 0 ].cells } );

    } catch ( err ) {

        console.error( '[circuits] GET error:', err );
        res.status( 500 ).json( { error: 'Internal server error' } );

    }

} );

export default router;
