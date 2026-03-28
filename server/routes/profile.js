import { Router } from 'express';
import { query, getClient } from '../db/client.js';
import { computeRaceRewards, computeLevel, xpForLevel } from '../db/xp.js';

const router = Router();

/** GET /api/profile/:username */
router.get( '/:username', async ( req, res ) => {

    const username = req.params.username.trim().slice( 0, 20 );

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

        const p = rows[ 0 ];
        p.xp_for_next = xpForLevel( p.level + 1 );

        return res.json( { player: p } );

    } catch ( err ) {

        console.error( '[profile] GET error:', err.message );
        return res.status( 500 ).json( { error: 'Server error' } );

    }

} );

/**
 * POST /api/profile/race-result
 * Body: { username, rank, players_count }
 * Returns: { xp_earned, credits_earned, level_up, new_level, player }
 */
router.post( '/race-result', async ( req, res ) => {

    const { username, rank, players_count } = req.body;

    if ( ! username || rank == null || ! players_count ) {

        return res.status( 400 ).json( { error: 'Missing fields' } );

    }

    const client = await getClient();

    try {

        await client.query( 'BEGIN' );

        // Fetch player + stats (lock row for update)
        const { rows } = await client.query(
            `SELECT p.id, s.level, s.xp, s.xp_this_level, s.credits, s.races_played, s.wins
             FROM players p
             JOIN player_stats s ON s.player_id = p.id
             WHERE p.username = $1
             FOR UPDATE OF s`,
            [ username ]
        );

        if ( rows.length === 0 ) {

            await client.query( 'ROLLBACK' );
            return res.status( 404 ).json( { error: 'Player not found' } );

        }

        const s = rows[ 0 ];
        const { xp: xpEarned, credits: creditsEarned } = computeRaceRewards( rank, players_count );

        const { level: newLevel, xp_this_level: newXpThisLevel } = computeLevel(
            s.level, s.xp_this_level, xpEarned
        );

        const levelUp   = newLevel > s.level;
        const newCredits = s.credits + creditsEarned;
        const newXp      = s.xp + xpEarned;
        const newWins    = s.wins + ( rank === 1 ? 1 : 0 );

        // Update stats
        await client.query(
            `UPDATE player_stats SET
                level         = $1,
                xp            = $2,
                xp_this_level = $3,
                credits       = $4,
                races_played  = races_played + 1,
                wins          = $5,
                updated_at    = NOW()
             WHERE player_id = $6`,
            [ newLevel, newXp, newXpThisLevel, newCredits, newWins, s.id ]
        );

        // Record race result
        await client.query(
            `INSERT INTO race_results (player_id, rank, players_count, xp_earned, credits_earned)
             VALUES ($1, $2, $3, $4, $5)`,
            [ s.id, rank, players_count, xpEarned, creditsEarned ]
        );

        await client.query( 'COMMIT' );

        return res.json( {
            xp_earned:      xpEarned,
            credits_earned: creditsEarned,
            level_up:       levelUp,
            new_level:      newLevel,
            xp_for_next:    xpForLevel( newLevel + 1 ),
            xp_this_level:  newXpThisLevel,
            credits:        newCredits,
            xp:             newXp,
        } );

    } catch ( err ) {

        await client.query( 'ROLLBACK' );
        console.error( '[profile] race-result error:', err.message );
        return res.status( 500 ).json( { error: 'Server error' } );

    } finally {

        client.release();

    }

} );

export default router;
