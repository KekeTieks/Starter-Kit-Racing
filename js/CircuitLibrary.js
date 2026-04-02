import { profileService } from './ProfileService.js';
import { parseCell } from '../shared/CellFormat.js';

// Colors per track piece type for the minimap SVG
const MINIMAP_COLORS = {
	'track-straight': '#8899aa',
	'track-corner':   '#6688bb',
	'track-finish':   '#dd4444',
	'track-bump':     '#cc8833',
	'track-ramp':     '#dd9944',
};

export async function loadCircuits() {

	const username = profileService.username;
	const url = username
		? '/api/circuits?username=' + encodeURIComponent( username )
		: '/api/circuits';

	const res = await fetch( url );
	if ( ! res.ok ) throw new Error( 'Failed to load circuits' );

	const data = await res.json();
	return data.circuits;

}

export async function saveCircuit( name, cells ) {

	const username = profileService.username;

	const res = await fetch( '/api/circuits', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( { cells, name, username } ),
	} );

	if ( ! res.ok ) throw new Error( 'Failed to save circuit' );

	const data = await res.json();
	return data.circuit;

}

export async function updateCircuit( id, cells, name ) {

	const username = profileService.username;

	const body = { username };
	if ( cells ) body.cells = cells;
	if ( name !== undefined ) body.name = name;

	const res = await fetch( '/api/circuits/' + id, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( body ),
	} );

	if ( ! res.ok ) throw new Error( 'Failed to update circuit' );

	const data = await res.json();
	return data.circuit;

}

export async function deleteCircuit( id ) {

	const username = profileService.username;

	const res = await fetch(
		'/api/circuits/' + id + '?username=' + encodeURIComponent( username ),
		{ method: 'DELETE' }
	);

	if ( ! res.ok ) throw new Error( 'Failed to delete circuit' );

}

export function generateMinimap( cells, size = 80 ) {

	if ( ! cells || cells.length === 0 ) return '<svg></svg>';

	const parsed = cells.map( parseCell );

	const minX = Math.min( ...parsed.map( c => c.gx ) );
	const maxX = Math.max( ...parsed.map( c => c.gx ) );
	const minZ = Math.min( ...parsed.map( c => c.gz ) );
	const maxZ = Math.max( ...parsed.map( c => c.gz ) );

	const cols = maxX - minX + 1;
	const rows = maxZ - minZ + 1;

	const cellSize = Math.floor( Math.min( size / cols, size / rows ) );
	const w = cols * cellSize;
	const h = rows * cellSize;

	const rects = parsed.map( ( c ) => {

		const x = ( c.gx - minX ) * cellSize;
		const y = ( c.gz - minZ ) * cellSize;
		const color = MINIMAP_COLORS[ c.type ] || '#aaaaaa';
		return `<rect x="${ x }" y="${ y }" width="${ cellSize }" height="${ cellSize }" fill="${ color }" rx="1"/>`;

	} ).join( '' );

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ w } ${ h }" width="${ w }" height="${ h }">${ rects }</svg>`;

}
