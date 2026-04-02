import { UPGRADE_CONFIG, MAX_UPGRADE_LEVEL } from './UpgradeConfig.js';
import { VEHICLE_STATS } from '../shared/VehicleStats.js';

class UpgradeService {

    constructor() {

        // { yellow: { engine: 2, brakes: 1 }, green: { grip: 3 }, ... }
        this._upgrades = {};

    }

    // ── Server sync ───────────────────────────────────────────────────────────

    /**
     * Load upgrades from server for a given username.
     * Call after login / refresh.
     */
    async loadFromServer( username ) {

        if ( ! username ) return;

        try {

            const res  = await fetch( `/api/upgrades/${ encodeURIComponent( username ) }` );
            const data = await res.json();

            if ( res.ok && data.upgrades ) {

                this._upgrades = data.upgrades;

            }

        } catch { /* non-fatal — upgrades stay empty */ }

    }

    /**
     * Purchase the next level of an upgrade.
     * Returns { ok: true, newLevel, newCredits, upgrades } or { ok: false, error }.
     */
    async purchase( username, vehicle, upgradeId ) {

        try {

            const res  = await fetch( '/api/upgrades/purchase', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify( { username, vehicle, upgradeId } ),
            } );

            const data = await res.json();

            if ( ! res.ok ) return { ok: false, error: data.error || 'Erreur serveur' };

            // Update local cache
            if ( data.upgrades ) this._upgrades = data.upgrades;

            return { ok: true, newLevel: data.newLevel ?? 0, newCredits: data.newCredits ?? 0 };

        } catch {

            return { ok: false, error: 'Serveur inaccessible' };

        }

    }

    // ── Accessors ─────────────────────────────────────────────────────────────

    /** Returns the current upgrade level for a vehicle/upgradeId (0 if none). */
    getLevel( vehicle, upgradeId ) {

        return this._upgrades?.[ vehicle ]?.[ upgradeId ] ?? 0;

    }

    /** Returns all upgrades for a vehicle as { engine: 2, brakes: 1 }. */
    getVehicleUpgrades( vehicle ) {

        return { ...( this._upgrades?.[ vehicle ] ?? {} ) };

    }

    /** Returns the cost of the next level for a given upgrade (null if maxed). */
    getNextLevelCost( vehicle, upgradeId ) {

        const def   = UPGRADE_CONFIG.find( ( u ) => u.id === upgradeId );
        const level = this.getLevel( vehicle, upgradeId );

        if ( ! def || level >= MAX_UPGRADE_LEVEL ) return null;

        return def.levels[ level ].cost;

    }

    /**
     * Computes cumulative stat deltas for a vehicle's current upgrades.
     * Returns e.g. { engineForce: 650, maxSpeed: 0.09 }.
     */
    computeDeltas( vehicle ) {

        const result  = {};
        const current = this._upgrades?.[ vehicle ] ?? {};

        for ( const def of UPGRADE_CONFIG ) {

            const level = Math.min( current[ def.id ] ?? 0, MAX_UPGRADE_LEVEL, def.levels.length );

            for ( let i = 0; i < level; i++ ) {

                for ( const [ stat, val ] of Object.entries( def.levels[ i ].delta ) ) {

                    result[ stat ] = ( result[ stat ] ?? 0 ) + val;

                }

            }

        }

        return result;

    }

    /**
     * Returns upgraded display stats for UI bars.
     * Values can exceed the base 5 scale — cap display at 8.
     */
    getDisplayStats( vehicle ) {

        const base    = VEHICLE_STATS[ vehicle ]?.display ?? { speed: 3, handling: 3, acceleration: 3 };
        const current = this._upgrades?.[ vehicle ] ?? {};
        const result  = { ...base };

        for ( const def of UPGRADE_CONFIG ) {

            const level = Math.min( current[ def.id ] ?? 0, MAX_UPGRADE_LEVEL, def.levels.length );
            result[ def.displayStat ] = +( result[ def.displayStat ] + def.displayGainPerLevel * level ).toFixed( 2 );

        }

        return result;

    }

    /**
     * Applies upgrade deltas to a stats object in place.
     * Use on the deep-cloned VEHICLE_STATS before passing to Vehicle/physics.
     */
    applyDeltasToStats( stats, vehicle ) {

        const deltas = this.computeDeltas( vehicle );

        for ( const [ stat, val ] of Object.entries( deltas ) ) {

            if ( typeof stats[ stat ] === 'number' ) {

                stats[ stat ] += val;

            }

        }

    }

}

export const upgradeService = new UpgradeService();
