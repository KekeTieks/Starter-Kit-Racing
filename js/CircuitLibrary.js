import { TRACK_CELLS } from './Track.js';

const LS_KEY = 'racing_circuits';

// Colors per track piece type for the minimap SVG
const MINIMAP_COLORS = {
	'track-straight': '#8899aa',
	'track-corner':   '#6688bb',
	'track-finish':   '#dd4444',
	'track-bump':     '#cc8833',
	'track-ramp':     '#dd9944',
};

const BUILTIN_CIRCUITS = [
	{ id: 'builtin-classic', name: 'Classic Loop', cells: TRACK_CELLS, builtin: true },
];

export function loadCircuits() {

	let custom = [];

	try {

		const raw = localStorage.getItem( LS_KEY );
		if ( raw ) custom = JSON.parse( raw );

	} catch ( _e ) {

		custom = [];

	}

	return [ ...BUILTIN_CIRCUITS, ...custom ];

}

export function saveCircuit( name, cells ) {

	let custom = [];

	try {

		const raw = localStorage.getItem( LS_KEY );
		if ( raw ) custom = JSON.parse( raw );

	} catch ( _e ) {

		custom = [];

	}

	const id = 'custom-' + Date.now();
	custom.push( { id, name, cells, createdAt: Date.now(), builtin: false } );
	localStorage.setItem( LS_KEY, JSON.stringify( custom ) );
	return id;

}

export function updateCircuit( id, cells ) {

	let custom = [];

	try {

		const raw = localStorage.getItem( LS_KEY );
		if ( raw ) custom = JSON.parse( raw );

	} catch ( _e ) {

		custom = [];

	}

	const idx = custom.findIndex( ( c ) => c.id === id );
	if ( idx !== - 1 ) {

		custom[ idx ] = { ...custom[ idx ], cells, updatedAt: Date.now() };
		localStorage.setItem( LS_KEY, JSON.stringify( custom ) );

	}

}

export function deleteCircuit( id ) {

	let custom = [];

	try {

		const raw = localStorage.getItem( LS_KEY );
		if ( raw ) custom = JSON.parse( raw );

	} catch ( _e ) {

		custom = [];

	}

	custom = custom.filter( ( c ) => c.id !== id );
	localStorage.setItem( LS_KEY, JSON.stringify( custom ) );

}

export function generateMinimap( cells, size = 80 ) {

	if ( ! cells || cells.length === 0 ) return '<svg></svg>';

	const gxs = cells.map( ( c ) => c[ 0 ] );
	const gzs = cells.map( ( c ) => c[ 1 ] );
	const minX = Math.min( ...gxs );
	const maxX = Math.max( ...gxs );
	const minZ = Math.min( ...gzs );
	const maxZ = Math.max( ...gzs );

	const cols = maxX - minX + 1;
	const rows = maxZ - minZ + 1;

	const cellSize = Math.floor( Math.min( size / cols, size / rows ) );
	const w = cols * cellSize;
	const h = rows * cellSize;

	const rects = cells.map( ( c ) => {

		const x = ( c[ 0 ] - minX ) * cellSize;
		const y = ( c[ 1 ] - minZ ) * cellSize;
		const color = MINIMAP_COLORS[ c[ 2 ] ] || '#aaaaaa';
		return `<rect x="${ x }" y="${ y }" width="${ cellSize }" height="${ cellSize }" fill="${ color }" rx="1"/>`;

	} ).join( '' );

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ w } ${ h }" width="${ w }" height="${ h }">${ rects }</svg>`;

}
