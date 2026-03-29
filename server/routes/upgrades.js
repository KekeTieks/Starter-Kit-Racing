import { Router } from 'express';
import { query, getClient } from '../db/client.js';
import { UPGRADE_CONFIG, MAX_UPGRADE_LEVEL } from '../simulation/UpgradeConfig.js';

const router = Router();

const VALID_VEHICLES = new Set( [ 'yellow', 'green', 'purple', 'red' ] );
const VALID_UPGRADES = new Set( UPGRADE_CONFIG.map( ( u ) => u.id ) );

/**
 * GET /api/upgrades/:username
 * Returns: { upgrades: { yellow: { engine: 2 }, green: { grip: 1 } } }
 */
router.get( '/:username', async ( req, res ) => {

    const username = req.params.username.trim().slice( 0, 20 );

    try {

        const { rows: playerRows } = await query(
            `SELECT p.id FROM players p WHERE p.username = $1`,
            [ username ]
        );

        if ( playerRows.length === 0 ) {

            return res.status( 404 ).json( { error: 'Player not found' } );

        }

        const playerId = playerRows[ 0 ].id;

        const { rows } = await query(
            `SELECT vehicle, upgrade_id, level
             FROM vehicle_upgrades
             WHERE player_id = $1 AND level > 0`,
            [ playerId ]
        );

        const upgrades = {};
        for ( const row of rows ) {

            if ( ! upgrades[ row.vehicle ] ) upgrades[ row.vehicle ] = {};
            upgrades[ row.vehicle ][ row.upgrade_id ] = row.level;

        }

        return res.json( { upgrades } );

    } catch ( err ) {

        console.error( '[upgrades] GET error:', err.message );
        return res.status( 500 ).json( { error: 'Server error' } );

    }

} );

/**
 * POST /api/upgrades/purchase
 * Body: { username, vehicle, upgradeId }
 * Returns: { ok, newLevel, newCredits, upgrades }
 */
router.post( '/purchase', async ( req, res ) => {

    const { username, vehicle, upgradeId } = req.body;

    if ( ! username || ! vehicle || ! upgradeId ) {

        return res.status( 400 ).json( { error: 'Missing fields' } );

    }

    if ( ! VALID_VEHICLES.has( vehicle ) ) {

        return res.status( 400 ).json( { error: 'Invalid vehicle' } );

    }

    if ( ! VALID_UPGRADES.has( upgradeId ) ) {

        return res.status( 400 ).json( { error: 'Invalid upgrade' } );

    }

    const upgradeDef = UPGRADE_CONFIG.find( ( u ) => u.id === upgradeId );

    if ( ! upgradeDef ) {

        return res.status( 400 ).json( { error: 'Invalid upgrade' } );

    }

    const client = await getClient();

    try {

        await client.query( 'BEGIN' );

        // Fetch player + credits (lock row)
        const { rows: playerRows } = await client.query(
            `SELECT p.id, s.credits
             FROM players p
             JOIN player_stats s ON s.player_id = p.id
             WHERE p.username = $1
             FOR UPDATE OF s`,
            [ username.trim().slice( 0, 20 ) ]
        );

        if ( playerRows.length === 0 ) {

            await client.query( 'ROLLBACK' );
            return res.status( 404 ).json( { error: 'Player not found' } );

        }

        const { id: playerId, credits } = playerRows[ 0 ];

        // Get current upgrade level for this vehicle/upgrade
        const { rows: upgradeRows } = await client.query(
            `SELECT level FROM vehicle_upgrades
             WHERE player_id = $1 AND vehicle = $2 AND upgrade_id = $3`,
            [ playerId, vehicle, upgradeId ]
        );

        const currentLevel = upgradeRows.length > 0 ? upgradeRows[ 0 ].level : 0;

        if ( currentLevel >= MAX_UPGRADE_LEVEL ) {

            await client.query( 'ROLLBACK' );
            return res.status( 400 ).json( { error: 'Niveau maximum atteint' } );

        }

        const cost = upgradeDef.levels[ currentLevel ].cost;

        if ( credits < cost ) {

            await client.query( 'ROLLBACK' );
            return res.status( 400 ).json( { error: 'Crédits insuffisants' } );

        }

        const newLevel   = currentLevel + 1;
        const newCredits = credits - cost;

        // Deduct credits
        await client.query(
            `UPDATE player_stats SET credits = $1, updated_at = NOW()
             WHERE player_id = $2`,
            [ newCredits, playerId ]
        );

        // Upsert upgrade level
        await client.query(
            `INSERT INTO vehicle_upgrades (player_id, vehicle, upgrade_id, level, updated_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (player_id, vehicle, upgrade_id)
             DO UPDATE SET level = $4, updated_at = NOW()`,
            [ playerId, vehicle, upgradeId, newLevel ]
        );

        await client.query( 'COMMIT' );

        // Fetch all upgrades to return updated state
        const { rows: allUpgradeRows } = await client.query(
            `SELECT vehicle, upgrade_id, level
             FROM vehicle_upgrades
             WHERE player_id = $1 AND level > 0`,
            [ playerId ]
        );

        const upgrades = {};
        for ( const row of allUpgradeRows ) {

            if ( ! upgrades[ row.vehicle ] ) upgrades[ row.vehicle ] = {};
            upgrades[ row.vehicle ][ row.upgrade_id ] = row.level;

        }

        return res.json( { ok: true, newLevel, newCredits, upgrades } );

    } catch ( err ) {

        await client.query( 'ROLLBACK' );
        console.error( '[upgrades] purchase error:', err.message );
        return res.status( 500 ).json( { error: 'Server error' } );

    } finally {

        client.release();

    }

} );

export default router;
