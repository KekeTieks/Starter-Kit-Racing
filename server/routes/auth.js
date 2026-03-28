import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db/client.js';

const router = Router();

/** POST /api/auth/register  { username } → { player } */
router.post( '/register', async ( req, res ) => {

    const username = ( req.body.username || '' ).trim().slice( 0, 20 );

    if ( ! username ) {

        return res.status( 400 ).json( { error: 'Username required' } );

    }

    // Validate: letters, numbers, underscores, hyphens only
    if ( ! /^[\w-]+$/.test( username ) ) {

        return res.status( 400 ).json( { error: 'Invalid username characters' } );

    }

    try {

        // Upsert: if the username already exists just return its profile
        // (password-less phase — no conflict on credentials)
        const existing = await query(
            'SELECT id FROM players WHERE username = $1',
            [ username ]
        );

        if ( existing.rows.length > 0 ) {

            return res.status( 409 ).json( { error: 'Username already taken' } );

        }

        const { rows: [ player ] } = await query(
            'INSERT INTO players (username) VALUES ($1) RETURNING id, username, created_at',
            [ username ]
        );

        // Create default stats row
        await query(
            'INSERT INTO player_stats (player_id) VALUES ($1)',
            [ player.id ]
        );

        return res.status( 201 ).json( { player } );

    } catch ( err ) {

        console.error( '[auth] register error:', err.message );
        return res.status( 500 ).json( { error: 'Server error' } );

    }

} );

/** POST /api/auth/login  { username } → { player, stats } */
router.post( '/login', async ( req, res ) => {

    const username = ( req.body.username || '' ).trim().slice( 0, 20 );

    if ( ! username ) {

        return res.status( 400 ).json( { error: 'Username required' } );

    }

    try {

        const { rows } = await query(
            `SELECT p.id, p.username, p.created_at,
                    s.level, s.xp, s.xp_this_level, s.credits, s.races_played, s.wins
             FROM players p
             JOIN player_stats s ON s.player_id = p.id
             WHERE p.username = $1`,
            [ username ]
        );

        if ( rows.length === 0 ) {

            return res.status( 404 ).json( { error: 'Player not found' } );

        }

        return res.json( { player: rows[ 0 ] } );

    } catch ( err ) {

        console.error( '[auth] login error:', err.message );
        return res.status( 500 ).json( { error: 'Server error' } );

    }

} );

export default router;
