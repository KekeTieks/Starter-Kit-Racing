// CosmeticService.js — Manages equipped cosmetics per vehicle.
// Uses server API (PostgreSQL) as source of truth, localStorage as cache.
//
// Loadout format (per vehicle):
//   { paint: 'paint_midnight', spoiler: 'spoiler_low', wheels: null, ... }
// A `null` value means "stock / default appearance".

import { COSMETIC_SLOTS, getItem } from './CosmeticConfig.js';

const LS_KEY = 'myrace_cosmetics';

export class CosmeticService {

	constructor() {

		// { [vehicleKey]: { [slotId]: itemId | null } }
		this._loadouts = {};
		this._owned = new Set(); // set of owned item ids
		this._loadCache();

	}

	// ── Local cache (localStorage) ──────────────────────────────────────

	_loadCache() {

		try {

			const raw = localStorage.getItem( LS_KEY );
			if ( raw ) {

				const data = JSON.parse( raw );
				this._loadouts = data.loadouts || {};
				this._owned = new Set( data.owned || [] );

			}

		} catch ( _e ) { /* corrupted — start fresh */ }

	}

	_saveCache() {

		localStorage.setItem( LS_KEY, JSON.stringify( {
			loadouts: this._loadouts,
			owned: Array.from( this._owned ),
		} ) );

	}

	// ── Server sync ─────────────────────────────────────────────────────

	/** Load cosmetics from server (call after login). */
	async loadFromServer( username ) {

		try {

			const res = await fetch( `/api/cosmetics/${ encodeURIComponent( username ) }` );
			if ( ! res.ok ) return;
			const data = await res.json();
			this._loadouts = data.loadouts || {};
			this._owned = new Set( data.owned || [] );
			this._saveCache();

		} catch ( _e ) {

			console.warn( '[cosmetics] Failed to load from server, using cache.' );

		}

	}

	/**
	 * Purchase an item on the server.
	 * Returns { ok, newCredits, owned } on success, { ok: false, error } on failure.
	 */
	async purchase( username, itemId ) {

		try {

			const res = await fetch( '/api/cosmetics/purchase', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { username, itemId } ),
			} );

			const data = await res.json();

			if ( res.ok && data.ok ) {

				this._owned = new Set( data.owned );
				this._saveCache();
				return { ok: true, newCredits: data.newCredits };

			}

			return { ok: false, error: data.error || 'Erreur' };

		} catch ( _e ) {

			return { ok: false, error: 'Serveur inaccessible' };

		}

	}

	/**
	 * Equip / unequip an item on the server.
	 * Returns { ok, loadout } on success, { ok: false, error } on failure.
	 */
	async equipOnServer( username, vehicleKey, slotId, itemId ) {

		try {

			const res = await fetch( '/api/cosmetics/equip', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { username, vehicle: vehicleKey, slotId, itemId } ),
			} );

			const data = await res.json();

			if ( res.ok && data.ok ) {

				// Update local state from server response
				this._loadouts[ vehicleKey ] = data.loadout;
				this._saveCache();
				return { ok: true };

			}

			return { ok: false, error: data.error || 'Erreur' };

		} catch ( _e ) {

			return { ok: false, error: 'Serveur inaccessible' };

		}

	}

	// ── Ownership ───────────────────────────────────────────────────────

	/** Check if a cosmetic item is owned. */
	isOwned( itemId ) {

		return this._owned.has( itemId );

	}

	/** Get all owned item ids. */
	getOwnedItems() {

		return Array.from( this._owned );

	}

	// ── Loadout management (local reads) ────────────────────────────────

	/**
	 * Get the full loadout for a vehicle.
	 * Returns { [slotId]: itemId | null } with every slot present.
	 */
	getLoadout( vehicleKey ) {

		const base = {};
		for ( const slot of COSMETIC_SLOTS ) base[ slot.id ] = null;
		return Object.assign( base, this._loadouts[ vehicleKey ] || {} );

	}

	/**
	 * Get the equipped item id for a specific slot on a vehicle.
	 * Returns itemId string or null (stock).
	 */
	getEquipped( vehicleKey, slotId ) {

		return this._loadouts[ vehicleKey ]?.[ slotId ] ?? null;

	}

	// ── Serialization (for network / multiplayer) ───────────────────────

	/**
	 * Serialize a vehicle's loadout into a plain object suitable for
	 * sending over the network (only non-null slots).
	 */
	serializeLoadout( vehicleKey ) {

		const loadout = this.getLoadout( vehicleKey );
		const out = {};
		for ( const [ slot, itemId ] of Object.entries( loadout ) ) {

			if ( itemId ) out[ slot ] = itemId;

		}

		return out;

	}

	/**
	 * Deserialize a network loadout into the full slot map.
	 * Used to apply cosmetics on remote vehicles.
	 */
	static deserializeLoadout( networkData ) {

		const base = {};
		for ( const slot of COSMETIC_SLOTS ) base[ slot.id ] = null;
		if ( networkData ) Object.assign( base, networkData );
		return base;

	}

}

export const cosmeticService = new CosmeticService();
