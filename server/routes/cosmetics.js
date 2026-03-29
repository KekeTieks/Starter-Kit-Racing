import { Router } from 'express';
import { query, getClient } from '../db/client.js';
import { getItem, VALID_ITEM_IDS, VALID_VEHICLES } from '../simulation/CosmeticConfig.js';

const router = Router();

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getPlayerId( username ) {

    const { rows } = await query(
        `SELECT id FROM players WHERE username = $1`,
        [ username.trim().slice( 0, 20 ) ]
    );
    return rows.length > 0 ? rows[ 0 ].id : null;

}

// ── GET /api/cosmetics/:username ────────────────────────────────────────────
// Returns: { loadouts: { yellow: { paint: 'paint_gold' }, ... }, owned: [ 'paint_gold', ... ] }

router.get( '/:username', async ( req, res ) => {

    try {

        const playerId = await getPlayerId( req.params.username );
        if ( ! playerId ) return res.status( 404 ).json( { error: 'Player not found' } );

        const [ cosmeticsResult, ownedResult ] = await Promise.all( [
            query(
                `SELECT vehicle, slot_id, item_id
                 FROM vehicle_cosmetics
                 WHERE player_id = $1`,
                [ playerId ]
            ),
            query(
                `SELECT item_id FROM owned_cosmetics WHERE player_id = $1`,
                [ playerId ]
            ),
        ] );

        const loadouts = {};
        for ( const row of cosmeticsResult.rows ) {

            if ( ! loadouts[ row.vehicle ] ) loadouts[ row.vehicle ] = {};
            loadouts[ row.vehicle ][ row.slot_id ] = row.item_id;

        }

        const owned = ownedResult.rows.map( ( r ) => r.item_id );

        return res.json( { loadouts, owned } );

    } catch ( err ) {

        console.error( '[cosmetics] GET error:', err.message );
        return res.status( 500 ).json( { error: 'Server error' } );

    }

} );

// ── POST /api/cosmetics/purchase ────────────────────────────────────────────
// Body: { username, itemId }
// Returns: { ok, newCredits, owned }

router.post( '/purchase', async ( req, res ) => {

    const { username, itemId } = req.body;

    if ( ! username || ! itemId ) {

        return res.status( 400 ).json( { error: 'Missing fields' } );

    }

    if ( ! VALID_ITEM_IDS.has( itemId ) ) {

        return res.status( 400 ).json( { error: 'Invalid item' } );

    }

    const item = getItem( itemId );

    const client = await getClient();

    try {

        await client.query( 'BEGIN' );

        const { rows: playerRows } = await client.query(
            `SELECT p.id, s.credits, s.level
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

        const { id: playerId, credits, level } = playerRows[ 0 ];

        // Check level requirement
        if ( level < item.requiredLevel ) {

            await client.query( 'ROLLBACK' );
            return res.status( 400 ).json( { error: `Niveau ${ item.requiredLevel } requis` } );

        }

        // Check already owned
        const { rows: ownedRows } = await client.query(
            `SELECT 1 FROM owned_cosmetics WHERE player_id = $1 AND item_id = $2`,
            [ playerId, itemId ]
        );

        if ( ownedRows.length > 0 ) {

            await client.query( 'ROLLBACK' );
            return res.status( 400 ).json( { error: 'Déjà possédé' } );

        }

        // Check credits
        if ( credits < item.cost ) {

            await client.query( 'ROLLBACK' );
            return res.status( 400 ).json( { error: 'Crédits insuffisants' } );

        }

        const newCredits = credits - item.cost;

        // Deduct credits
        await client.query(
            `UPDATE player_stats SET credits = $1, updated_at = NOW()
             WHERE player_id = $2`,
            [ newCredits, playerId ]
        );

        // Insert owned item
        await client.query(
            `INSERT INTO owned_cosmetics (player_id, item_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [ playerId, itemId ]
        );

        await client.query( 'COMMIT' );

        // Return updated owned list
        const { rows: allOwned } = await query(
            `SELECT item_id FROM owned_cosmetics WHERE player_id = $1`,
            [ playerId ]
        );

        return res.json( {
            ok: true,
            newCredits,
            owned: allOwned.map( ( r ) => r.item_id ),
        } );

    } catch ( err ) {

        await client.query( 'ROLLBACK' );
        console.error( '[cosmetics] purchase error:', err.message );
        return res.status( 500 ).json( { error: 'Server error' } );

    } finally {

        client.release();

    }

} );

// ── POST /api/cosmetics/equip ───────────────────────────────────────────────
// Body: { username, vehicle, slotId, itemId }   (itemId = null to unequip)
// Returns: { ok, loadout }

router.post( '/equip', async ( req, res ) => {

    const { username, vehicle, slotId, itemId } = req.body;

    if ( ! username || ! vehicle || ! slotId ) {

        return res.status( 400 ).json( { error: 'Missing fields' } );

    }

    if ( ! VALID_VEHICLES.has( vehicle ) ) {

        return res.status( 400 ).json( { error: 'Invalid vehicle' } );

    }

    if ( itemId && ! VALID_ITEM_IDS.has( itemId ) ) {

        return res.status( 400 ).json( { error: 'Invalid item' } );

    }

    try {

        const playerId = await getPlayerId( username );
        if ( ! playerId ) return res.status( 404 ).json( { error: 'Player not found' } );

        // If equipping a non-null item, verify ownership
        if ( itemId ) {

            const { rows: ownedRows } = await query(
                `SELECT 1 FROM owned_cosmetics WHERE player_id = $1 AND item_id = $2`,
                [ playerId, itemId ]
            );

            if ( ownedRows.length === 0 ) {

                return res.status( 400 ).json( { error: 'Item non possédé' } );

            }

        }

        if ( itemId ) {

            // Upsert equipped item
            await query(
                `INSERT INTO vehicle_cosmetics (player_id, vehicle, slot_id, item_id, updated_at)
                 VALUES ($1, $2, $3, $4, NOW())
                 ON CONFLICT (player_id, vehicle, slot_id)
                 DO UPDATE SET item_id = $4, updated_at = NOW()`,
                [ playerId, vehicle, slotId, itemId ]
            );

        } else {

            // Unequip = delete row
            await query(
                `DELETE FROM vehicle_cosmetics
                 WHERE player_id = $1 AND vehicle = $2 AND slot_id = $3`,
                [ playerId, vehicle, slotId ]
            );

        }

        // Return updated loadout for this vehicle
        const { rows } = await query(
            `SELECT slot_id, item_id
             FROM vehicle_cosmetics
             WHERE player_id = $1 AND vehicle = $2`,
            [ playerId, vehicle ]
        );

        const loadout = {};
        for ( const row of rows ) loadout[ row.slot_id ] = row.item_id;

        return res.json( { ok: true, loadout } );

    } catch ( err ) {

        console.error( '[cosmetics] equip error:', err.message );
        return res.status( 500 ).json( { error: 'Server error' } );

    }

} );

export default router;
