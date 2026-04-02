// ─── EditorCells.js ───────────────────────────────────────────────────────────
// Cell operations: place road/bump/finish, toggle checkpoint, erase, clear.
// Also: mesh placement, cell resolution, persistence, and history management.

import * as THREE from 'three';
import { ORIENT_DEG, CELL_RAW, buildRampMesh, buildTunnelCeiling } from '../Track.js';
import { parseCell, serializeCell } from '../../shared/CellFormat.js';
import { grid, state, history, redoStack, MAX_HISTORY, cellKey } from './EditorState.js';
import { models } from './EditorModels.js';
import { trackGroup } from './EditorScene.js';
import {
	ORIENT_FLIP, getCellExits, getConnectivityMask, resolveNewTile, resolveTile, getCellExits as _exits,
} from './EditorAutotile.js';

// ── Checkpoint marker geometry (shared) ──────────────────────────────────────

export const cpMarkerGeo = new THREE.OctahedronGeometry( 1.5, 0 );
export const cpMarkerMat = new THREE.MeshBasicMaterial( { color: 0xff8800, wireframe: true } );

// ── History ───────────────────────────────────────────────────────────────────

function snapshotGrid() {

	const snap = [];
	for ( const [ key, cell ] of grid ) {

		const [ gx, gz ] = key.split( ',' ).map( Number );
		snap.push( {
			gx, gz,
			type: cell.type,
			orient: cell.orient,
			isFinish: cell.isFinish,
			isCheckpoint: cell.isCheckpoint,
			isBump: cell.isBump,
			bumpOrient: cell.bumpOrient,
			isTunnel: cell.isTunnel,
			rampLength: cell.rampLength,
			rampAngle: cell.rampAngle,
			rampWidth: cell.rampWidth,
		} );

	}

	return snap;

}

export function pushHistory() {

	history.push( snapshotGrid() );
	if ( history.length > MAX_HISTORY ) history.shift();
	redoStack.length = 0;
	updateUndoRedoButtons();

}

export function restoreSnapshot( snap ) {

	for ( const [ , cell ] of grid ) {

		if ( cell.mesh ) trackGroup.remove( cell.mesh );
		if ( cell.bumpMesh ) trackGroup.remove( cell.bumpMesh );
		if ( cell.tunnelMesh ) trackGroup.remove( cell.tunnelMesh );
		if ( cell.cpMarker ) trackGroup.remove( cell.cpMarker );

	}

	grid.clear();

	for ( const s of snap ) {

		const cell = {
			type: s.type, orient: s.orient,
			isFinish: s.isFinish, isCheckpoint: s.isCheckpoint, isBump: s.isBump, bumpOrient: s.bumpOrient,
			isTunnel: s.isTunnel,
			rampLength: s.rampLength, rampAngle: s.rampAngle, rampWidth: s.rampWidth,
			mesh: null, bumpMesh: null, tunnelMesh: null, cpMarker: null,
		};
		grid.set( cellKey( s.gx, s.gz ), cell );
		placeMesh( s.gx, s.gz, cell );

		if ( s.isCheckpoint ) {

			const marker = new THREE.Mesh( cpMarkerGeo, cpMarkerMat );
			marker.position.set( ( s.gx + 0.5 ) * CELL_RAW, 3.5, ( s.gz + 0.5 ) * CELL_RAW );
			trackGroup.add( marker );
			cell.cpMarker = marker;

		}

	}

	save();

}

export function undo() {

	if ( history.length === 0 ) return;
	redoStack.push( snapshotGrid() );
	restoreSnapshot( history.pop() );
	updateUndoRedoButtons();

}

export function redo() {

	if ( redoStack.length === 0 ) return;
	history.push( snapshotGrid() );
	restoreSnapshot( redoStack.pop() );
	updateUndoRedoButtons();

}

function updateUndoRedoButtons() {

	const btnUndo = document.getElementById( 'btn-undo' );
	const btnRedo = document.getElementById( 'btn-redo' );
	if ( btnUndo ) btnUndo.disabled = history.length === 0;
	if ( btnRedo ) btnRedo.disabled = redoStack.length === 0;

}

// ── Mesh placement ────────────────────────────────────────────────────────────

function spawnMesh( type, gx, gz, orient ) {

	const src = models[ type ];
	if ( ! src ) return null;

	const mesh = src.clone();
	mesh.position.set( ( gx + 0.5 ) * CELL_RAW, 0.5, ( gz + 0.5 ) * CELL_RAW );
	mesh.rotation.y = THREE.MathUtils.degToRad( ORIENT_DEG[ orient ] || 0 );
	mesh.traverse( ( c ) => {

		if ( c.isMesh ) { c.castShadow = true; c.receiveShadow = true; }

	} );

	trackGroup.add( mesh );
	return mesh;

}

export function placeMesh( gx, gz, cell ) {

	// Remove existing meshes
	if ( cell.mesh ) trackGroup.remove( cell.mesh );
	if ( cell.bumpMesh ) trackGroup.remove( cell.bumpMesh );
	if ( cell.tunnelMesh ) trackGroup.remove( cell.tunnelMesh );
	cell.bumpMesh = null;
	cell.tunnelMesh = null;

	// For track-ramp, render a road straight underneath + ramp mesh on top
	const roadType = cell.type === 'track-ramp' ? 'track-straight' : cell.type;
	cell.mesh = spawnMesh( roadType, gx, gz, cell.orient );

	if ( cell.type === 'track-ramp' ) {

		const rampMesh = buildRampMesh(
			cell.rampLength ?? 1.0,
			cell.rampAngle  ?? 15,
			cell.rampWidth  ?? 1.0,
		);
		rampMesh.position.set( ( gx + 0.5 ) * CELL_RAW, 0.5, ( gz + 0.5 ) * CELL_RAW );
		rampMesh.rotation.y = THREE.MathUtils.degToRad( ORIENT_DEG[ cell.orient ] || 0 );
		rampMesh.traverse( ( c ) => { if ( c.isMesh ) { c.castShadow = true; c.receiveShadow = true; } } );
		trackGroup.add( rampMesh );
		cell.bumpMesh = rampMesh;
		return;

	}

	// Bump overlay: place track-bump mesh on top of the road tile
	cell.bumpMesh = cell.isBump ? spawnMesh( 'track-bump', gx, gz, cell.bumpOrient ?? cell.orient ) : null;

	// Tunnel ceiling overlay
	if ( cell.isTunnel ) {

		const tunnel = buildTunnelCeiling();
		tunnel.position.set( ( gx + 0.5 ) * CELL_RAW, 0, ( gz + 0.5 ) * CELL_RAW );
		tunnel.rotation.y = THREE.MathUtils.degToRad( ORIENT_DEG[ cell.orient ] || 0 );
		tunnel.traverse( ( c ) => { if ( c.isMesh ) { c.castShadow = true; c.receiveShadow = true; } } );
		trackGroup.add( tunnel );
		cell.tunnelMesh = tunnel;

	}

}

// ── Cell resolution ───────────────────────────────────────────────────────────

export function resolveCell( gx, gz ) {

	const key = cellKey( gx, gz );
	const cell = grid.get( key );
	if ( ! cell ) return;

	let baseType, orient;

	if ( ! cell.mesh ) {

		[ baseType, orient ] = resolveNewTile( gx, gz );

	} else {

		const cMask = getConnectivityMask( gx, gz );
		const currentExits = getCellExits( cell );
		const currentConnected = currentExits & cMask;

		[ baseType, orient ] = resolveTile( gx, gz );

		const proposedExits = getCellExits( { type: baseType, orient } );
		if ( ( proposedExits & currentConnected ) !== currentConnected ) return;

	}

	// Preserve ramp type (track-ramp always behaves as track-straight for autotile)
	const type = cell.isFinish && baseType === 'track-straight'
		? 'track-finish'
		: cell.type === 'track-ramp' && baseType === 'track-straight'
			? 'track-ramp'
			: baseType;

	if ( cell.type === type && cell.orient === orient && cell.mesh ) return;

	cell.type = type;
	cell.orient = orient;
	placeMesh( gx, gz, cell );

}

export function resolveCellAndNeighbors( gx, gz ) {

	resolveCell( gx, gz );
	resolveCell( gx, gz - 1 );
	resolveCell( gx, gz + 1 );
	resolveCell( gx + 1, gz );
	resolveCell( gx - 1, gz );

}

// ── Cell operations ───────────────────────────────────────────────────────────

export function placeRoad( gx, gz ) {

	const key = cellKey( gx, gz );

	if ( grid.has( key ) ) {

		const cell = grid.get( key );
		pushHistory();
		// Flip orientation — bump overlay follows the road orient
		cell.orient = ORIENT_FLIP[ cell.orient ] ?? cell.orient;
		if ( cell.isBump ) cell.bumpOrient = cell.orient;
		placeMesh( gx, gz, cell );
		resolveCell( gx, gz - 1 );
		resolveCell( gx, gz + 1 );
		resolveCell( gx + 1, gz );
		resolveCell( gx - 1, gz );
		save();
		return;

	}

	pushHistory();
	grid.set( key, { type: 'track-straight', orient: 0, isFinish: false, isCheckpoint: false, isBump: false, bumpOrient: undefined, isTunnel: false, mesh: null, bumpMesh: null, tunnelMesh: null, cpMarker: null } );
	resolveCellAndNeighbors( gx, gz );
	save();

}

export function placeBump( gx, gz ) {

	const key = cellKey( gx, gz );
	const cell = grid.get( key );

	// Bump can only be placed on an existing road tile (not finish, not empty)
	if ( ! cell || cell.isFinish ) return;

	pushHistory();

	if ( cell.isBump ) {

		// Already has a bump → flip the bump orientation independently
		cell.bumpOrient = ORIENT_FLIP[ cell.bumpOrient ?? cell.orient ] ?? cell.orient;

	} else {

		// Add bump overlay — inherit road orientation
		cell.isBump = true;
		cell.bumpOrient = cell.orient;

	}

	placeMesh( gx, gz, cell );
	save();

}

export function placeRamp( gx, gz, rampLength, rampAngle, rampWidth ) {

	const key = cellKey( gx, gz );
	const cell = grid.get( key );

	// Ramp can only be placed on an existing road tile (not finish, not empty)
	if ( ! cell || cell.isFinish ) return;

	pushHistory();

	if ( cell.type === 'track-ramp' ) {

		// Already a ramp: update params and flip orientation
		cell.rampLength = rampLength;
		cell.rampAngle  = rampAngle;
		cell.rampWidth  = rampWidth;
		cell.orient = ORIENT_FLIP[ cell.orient ] ?? cell.orient;

	} else {

		// Convert road cell to track-ramp (keeps road mesh underneath via placeMesh)
		cell.type = 'track-ramp';
		cell.rampLength = rampLength;
		cell.rampAngle  = rampAngle;
		cell.rampWidth  = rampWidth;
		// Remove any existing bump/tunnel since ramp replaces them visually
		cell.isBump = false;
		cell.bumpOrient = undefined;
		cell.isTunnel = false;

	}

	placeMesh( gx, gz, cell );
	save();

}

export function removeRamp( gx, gz ) {

	const key = cellKey( gx, gz );
	const cell = grid.get( key );
	if ( ! cell || cell.type !== 'track-ramp' ) return;

	pushHistory();
	cell.type = 'track-straight';
	cell.rampLength = undefined;
	cell.rampAngle  = undefined;
	cell.rampWidth  = undefined;
	placeMesh( gx, gz, cell );
	save();

}

export function removeBump( gx, gz ) {

	const key = cellKey( gx, gz );
	const cell = grid.get( key );
	if ( ! cell || ! cell.isBump ) return;

	pushHistory();
	cell.isBump = false;
	cell.bumpOrient = undefined;
	if ( cell.bumpMesh ) { trackGroup.remove( cell.bumpMesh ); cell.bumpMesh = null; }
	save();

}

export function placeTunnel( gx, gz ) {

	const key = cellKey( gx, gz );
	const cell = grid.get( key );

	// Tunnel can only be placed on existing road (not finish, not ramp)
	if ( ! cell || cell.isFinish || cell.type === 'track-ramp' ) return;

	pushHistory();

	if ( cell.isTunnel ) {

		// Already a tunnel → remove it (toggle behavior)
		cell.isTunnel = false;
		if ( cell.tunnelMesh ) { trackGroup.remove( cell.tunnelMesh ); cell.tunnelMesh = null; }

	} else {

		cell.isTunnel = true;
		placeMesh( gx, gz, cell );

	}

	save();

}

export function removeTunnel( gx, gz ) {

	const key = cellKey( gx, gz );
	const cell = grid.get( key );
	if ( ! cell || ! cell.isTunnel ) return;

	pushHistory();
	cell.isTunnel = false;
	if ( cell.tunnelMesh ) { trackGroup.remove( cell.tunnelMesh ); cell.tunnelMesh = null; }
	save();

}

export function placeFinish() {

	const cell = { type: 'track-finish', orient: 0, isFinish: true, isCheckpoint: false, isBump: false, bumpOrient: undefined, isTunnel: false, mesh: null, bumpMesh: null, tunnelMesh: null, cpMarker: null };
	grid.set( cellKey( 0, 0 ), cell );
	placeMesh( 0, 0, cell );

}

export function toggleCheckpoint( gx, gz ) {

	const key = cellKey( gx, gz );
	const cell = grid.get( key );
	if ( ! cell || cell.isFinish ) return;

	pushHistory();
	cell.isCheckpoint = ! cell.isCheckpoint;

	if ( cell.isCheckpoint ) {

		const marker = new THREE.Mesh( cpMarkerGeo, cpMarkerMat );
		marker.position.set( ( gx + 0.5 ) * CELL_RAW, 3.5, ( gz + 0.5 ) * CELL_RAW );
		marker.scale.setScalar( 1 );
		trackGroup.add( marker );
		cell.cpMarker = marker;

	} else {

		if ( cell.cpMarker ) {

			trackGroup.remove( cell.cpMarker );
			cell.cpMarker = null;

		}

	}

	save();

}

export function eraseRoad( gx, gz, clearGhostFn ) {

	const key = cellKey( gx, gz );
	if ( ! grid.has( key ) ) return;

	if ( clearGhostFn ) clearGhostFn();

	const cell = grid.get( key );
	if ( cell.isFinish ) return;

	pushHistory();

	if ( cell.mesh ) trackGroup.remove( cell.mesh );
	if ( cell.bumpMesh ) trackGroup.remove( cell.bumpMesh );
	if ( cell.tunnelMesh ) trackGroup.remove( cell.tunnelMesh );
	if ( cell.cpMarker ) trackGroup.remove( cell.cpMarker );
	grid.delete( key );

	resolveCell( gx, gz - 1 );
	resolveCell( gx, gz + 1 );
	resolveCell( gx + 1, gz );
	resolveCell( gx - 1, gz );

	save();

}

export function clearAll( clearGhostFn ) {

	if ( clearGhostFn ) clearGhostFn();

	pushHistory();

	for ( const [ , cell ] of grid ) {

		if ( cell.mesh ) trackGroup.remove( cell.mesh );
		if ( cell.bumpMesh ) trackGroup.remove( cell.bumpMesh );
		if ( cell.tunnelMesh ) trackGroup.remove( cell.tunnelMesh );
		if ( cell.cpMarker ) trackGroup.remove( cell.cpMarker );

	}

	grid.clear();
	state.currentCircuitId = null;
	state.currentCircuitName = null;
	placeFinish();
	save();

}

// ── Persistence ───────────────────────────────────────────────────────────────

export function getCellsArray() {

	const arr = [];
	for ( const [ key, cell ] of grid ) {

		const [ gx, gz ] = key.split( ',' ).map( Number );
		arr.push( serializeCell( gx, gz, cell ) );

	}

	return arr;

}

export function save() {

	localStorage.setItem( 'racing-editor-cells-v2', JSON.stringify( getCellsArray() ) );

}

function loadCellsArray( arr ) {

	for ( const entry of arr ) {

		const c = parseCell( entry );
		const cell = {
			type:         c.type,
			orient:       c.orient,
			isFinish:     c.type === 'track-finish',
			isCheckpoint: c.isCheckpoint,
			isBump:       c.isBump,
			bumpOrient:   c.bumpOrient,
			isTunnel:     c.isTunnel,
			rampLength:   c.rampLength,
			rampAngle:    c.rampAngle,
			rampWidth:    c.rampWidth,
			mesh: null, bumpMesh: null, tunnelMesh: null, cpMarker: null,
		};

		grid.set( cellKey( c.gx, c.gz ), cell );
		placeMesh( c.gx, c.gz, cell );

		if ( c.isCheckpoint ) {

			const marker = new THREE.Mesh( cpMarkerGeo, cpMarkerMat );
			marker.position.set( ( c.gx + 0.5 ) * CELL_RAW, 3.5, ( c.gz + 0.5 ) * CELL_RAW );
			trackGroup.add( marker );
			cell.cpMarker = marker;

		}

	}

}

export function loadSaved() {

	try {

		const raw = localStorage.getItem( 'racing-editor-cells-v2' );
		if ( raw ) {

			// parseCell handles both old array format and new object format transparently
			loadCellsArray( JSON.parse( raw ) );

		}

	} catch ( e ) {

		console.warn( 'Failed to load saved map', e );

	}

}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateCircuit() {

	if ( grid.size === 0 ) return { ok: false, msg: 'Dessine une piste d\'abord !' };

	const hasCheckpoint = [ ...grid.values() ].some( c => c.isCheckpoint );
	if ( ! hasCheckpoint ) return { ok: false, msg: 'Ajoute au moins un checkpoint !' };

	let finishKey = null;
	for ( const [ key, cell ] of grid ) {

		if ( cell.isFinish ) { finishKey = key; break; }

	}

	if ( ! finishKey ) return { ok: false, msg: 'Pas de ligne de départ !' };

	for ( const [ key, cell ] of grid ) {

		const [ x, z ] = key.split( ',' ).map( Number );
		const exits = getCellExits( cell );
		const conn = getConnectivityMask( x, z );
		if ( ( exits & conn ) !== exits ) {

			return { ok: false, msg: 'La piste a des sorties non connectées (cul-de-sac) !' };

		}

	}

	const visited = new Set();
	const queue = [ finishKey ];
	visited.add( finishKey );

	while ( queue.length > 0 ) {

		const k = queue.shift();
		const [ x, z ] = k.split( ',' ).map( Number );
		const cell = grid.get( k );
		const exits = getCellExits( cell );

		const neighbors = [
			{ bit: 8, oppBit: 4, nx: x,     nz: z - 1 },
			{ bit: 4, oppBit: 8, nx: x,     nz: z + 1 },
			{ bit: 2, oppBit: 1, nx: x + 1, nz: z     },
			{ bit: 1, oppBit: 2, nx: x - 1, nz: z     },
		];

		for ( const { bit, oppBit, nx, nz } of neighbors ) {

			if ( ! ( exits & bit ) ) continue;
			const nk = cellKey( nx, nz );
			const ncell = grid.get( nk );
			if ( ! ncell ) continue;
			if ( ! ( getCellExits( ncell ) & oppBit ) ) continue;
			if ( ! visited.has( nk ) ) {

				visited.add( nk );
				queue.push( nk );

			}

		}

	}

	if ( visited.size !== grid.size ) {

		return { ok: false, msg: 'La piste n\'est pas une boucle fermée !' };

	}

	return { ok: true };

}
