// ─── EditorAutotile.js ────────────────────────────────────────────────────────
// Auto-tile resolution: bitmask connectivity, tile selection, neighbour analysis.
// Bitmask: N=8 S=4 E=2 W=1

import { grid, cellKey } from './EditorState.js';

export const ORIENT_FLIP = { 0: 10, 10: 0, 16: 22, 22: 16 };

// Corner connectivity: 0°=S+W, 90°=S+E, 180°=N+E, 270°=N+W
export const AUTOTILE = [
	[ 'track-straight', 0 ],    //  0: isolated
	[ 'track-straight', 16 ],   //  1: W
	[ 'track-straight', 16 ],   //  2: E
	[ 'track-straight', 16 ],   //  3: E+W
	[ 'track-straight', 0 ],    //  4: S
	[ 'track-corner',   0 ],    //  5: S+W
	[ 'track-corner',   16 ],   //  6: S+E
	[ 'track-straight', 16 ],   //  7: S+E+W
	[ 'track-straight', 0 ],    //  8: N
	[ 'track-corner',   22 ],   //  9: N+W
	[ 'track-corner',   10 ],   // 10: N+E
	[ 'track-straight', 16 ],   // 11: N+E+W
	[ 'track-straight', 0 ],    // 12: N+S
	[ 'track-straight', 0 ],    // 13: N+S+W
	[ 'track-straight', 0 ],    // 14: N+S+E
	[ 'track-straight', 0 ],    // 15: N+S+E+W
];

const DIR_INFO = [
	{ bit: 8, dx: 0, dz: - 1 }, // N
	{ bit: 4, dx: 0, dz: 1 },   // S
	{ bit: 2, dx: 1, dz: 0 },   // E
	{ bit: 1, dx: - 1, dz: 0 }, // W
];

// Exit bitmask for each piece type/orient
export function getCellExits( cell ) {

	const t = cell.type;
	const o = cell.orient;

	if ( t === 'track-corner' ) {

		if ( o === 0 ) return 5;    // S+W
		if ( o === 16 ) return 6;   // S+E
		if ( o === 10 ) return 10;  // N+E
		if ( o === 22 ) return 9;   // N+W

	}

	// Straight, finish, bump — all symmetric
	if ( o === 0 || o === 10 ) return 12; // N+S
	return 3; // E+W

}

// Which neighbors have an exit facing toward (gx, gz)
export function getConnectivityMask( gx, gz ) {

	let mask = 0;
	const n = grid.get( cellKey( gx, gz - 1 ) );
	if ( n && ( getCellExits( n ) & 4 ) ) mask |= 8;
	const s = grid.get( cellKey( gx, gz + 1 ) );
	if ( s && ( getCellExits( s ) & 8 ) ) mask |= 4;
	const e = grid.get( cellKey( gx + 1, gz ) );
	if ( e && ( getCellExits( e ) & 1 ) ) mask |= 2;
	const w = grid.get( cellKey( gx - 1, gz ) );
	if ( w && ( getCellExits( w ) & 2 ) ) mask |= 1;
	return mask;

}

// Any road present in adjacent cell (direction-agnostic)
export function getPresenceMask( gx, gz ) {

	let mask = 0;
	if ( grid.has( cellKey( gx, gz - 1 ) ) ) mask |= 8;
	if ( grid.has( cellKey( gx, gz + 1 ) ) ) mask |= 4;
	if ( grid.has( cellKey( gx + 1, gz ) ) ) mask |= 2;
	if ( grid.has( cellKey( gx - 1, gz ) ) ) mask |= 1;
	return mask;

}

export function bitCount( mask ) {

	return ( mask >> 3 & 1 ) + ( mask >> 2 & 1 ) + ( mask >> 1 & 1 ) + ( mask & 1 );

}

export function connectedExitCount( gx, gz ) {

	const cell = grid.get( cellKey( gx, gz ) );
	if ( ! cell ) return 0;
	return bitCount( getCellExits( cell ) & getConnectivityMask( gx, gz ) );

}

// When a new cell has 3+ available neighbors, pick the best pair to connect.
function pickBestPair( mask, gx, gz ) {

	const active = DIR_INFO.filter( d => mask & d.bit );
	if ( active.length <= 2 ) return mask;

	let bestMask = active[ 0 ].bit | active[ 1 ].bit;
	let bestScore = - 1;
	let bestIsCorner = false;

	for ( let i = 0; i < active.length; i ++ ) {

		for ( let j = i + 1; j < active.length; j ++ ) {

			const pairMask = active[ i ].bit | active[ j ].bit;
			const isCorner = ( pairMask !== 3 && pairMask !== 12 );
			const s1 = connectedExitCount( gx + active[ i ].dx, gz + active[ i ].dz );
			const s2 = connectedExitCount( gx + active[ j ].dx, gz + active[ j ].dz );
			const score = s1 + s2;

			if ( ( isCorner && ! bestIsCorner ) || ( isCorner === bestIsCorner && score > bestScore ) ) {

				bestMask = pairMask;
				bestScore = score;
				bestIsCorner = isCorner;

			}

		}

	}

	return bestMask;

}

// Neighbors that can connect: already exit toward us, or have a free exit
function getAvailableMask( gx, gz ) {

	let mask = 0;
	const dirs = [
		[ 0, - 1, 8, 4 ],
		[ 0, 1, 4, 8 ],
		[ 1, 0, 2, 1 ],
		[ - 1, 0, 1, 2 ],
	];

	for ( const [ dx, dz, bit, oppBit ] of dirs ) {

		const neighbor = grid.get( cellKey( gx + dx, gz + dz ) );
		if ( ! neighbor ) continue;

		const exits = getCellExits( neighbor );
		if ( exits & oppBit ) { mask |= bit; continue; }

		const conn = getConnectivityMask( gx + dx, gz + dz );
		if ( bitCount( exits & conn ) < 2 ) mask |= bit;

	}

	return mask;

}

// Tile for new cells
export function resolveNewTile( gx, gz ) {

	const pMask = getAvailableMask( gx, gz );
	if ( bitCount( pMask ) >= 3 ) return AUTOTILE[ pickBestPair( pMask, gx, gz ) ];
	return AUTOTILE[ pMask ];

}

// Tile for existing cells (re-resolve without breaking connections)
export function resolveTile( gx, gz ) {

	const cMask = getConnectivityMask( gx, gz );
	if ( cMask !== 0 ) return AUTOTILE[ cMask ];

	const pMask = getPresenceMask( gx, gz );
	if ( pMask !== 0 ) {

		const dirs = [ [ 0, - 1, 8 ], [ 0, 1, 4 ], [ 1, 0, 2 ], [ - 1, 0, 1 ] ];
		for ( const [ dx, dz, bit ] of dirs ) {

			if ( ! ( pMask & bit ) ) continue;
			const neighbor = grid.get( cellKey( gx + dx, gz + dz ) );
			if ( ! neighbor ) continue;

			const exits = getCellExits( neighbor );
			if ( exits & 12 ) return [ 'track-straight', 0 ];
			if ( exits & 3 ) return [ 'track-straight', 16 ];

		}

	}

	return AUTOTILE[ 0 ];

}
