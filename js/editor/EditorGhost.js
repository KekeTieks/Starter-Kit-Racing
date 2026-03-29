// ─── EditorGhost.js ───────────────────────────────────────────────────────────
// Ghost preview (placement hint) and erase hover tint.

import * as THREE from 'three';
import { ORIENT_DEG, CELL_RAW } from '../Track.js';
import { grid, state, cellKey } from './EditorState.js';
import { models } from './EditorModels.js';
import { ghostGroup } from './EditorScene.js';
import { getCellExits, getConnectivityMask, resolveNewTile, resolveTile } from './EditorAutotile.js';

// Neighbor cells temporarily hidden during ghost preview
const ghostNeighborBackups = [];

// Erase hover: the currently tinted mesh and its original materials
let eraseHoverCell = null;
const eraseHoverOrigMaterials = [];

function addGhostPiece( type, orient, gx, gz, opacity ) {

	const src = models[ type ];
	if ( ! src ) return;

	const mesh = src.clone();
	mesh.position.set( ( gx + 0.5 ) * CELL_RAW, 0.5, ( gz + 0.5 ) * CELL_RAW );
	mesh.rotation.y = THREE.MathUtils.degToRad( ORIENT_DEG[ orient ] || 0 );

	mesh.traverse( ( c ) => {

		if ( c.isMesh ) {

			c.material = c.material.clone();
			c.material.transparent = true;
			c.material.opacity = opacity;

		}

	} );

	ghostGroup.add( mesh );

}

export function updateGhost( gx, gz ) {

	clearGhost();

	if ( state.tool === 'erase' ) {

		const key = cellKey( gx, gz );
		const cell = grid.get( key );
		if ( ! cell || cell.isFinish || ! cell.mesh ) return;

		eraseHoverCell = cell;
		cell.mesh.traverse( ( c ) => {

			if ( ! c.isMesh ) return;
			eraseHoverOrigMaterials.push( { mesh: c, mat: c.material } );
			const tinted = c.material.clone();
			tinted.color = new THREE.Color( 0.9, 0.15, 0.1 );
			tinted.emissive = new THREE.Color( 0.4, 0.0, 0.0 );
			tinted.emissiveIntensity = 0.6;
			c.material = tinted;

		} );

		return;

	}

	const key = cellKey( gx, gz );
	if ( grid.has( key ) ) return;

	// Bump tool only applies on existing cells — no ghost for empty tiles
	if ( state.tool === 'bump' ) return;

	const ghostCell = { type: 'track-straight', orient: 0, isFinish: false, isBump: false, mesh: null };
	grid.set( key, ghostCell );

	const [ type, orient ] = resolveNewTile( gx, gz );
	ghostCell.type = type;
	ghostCell.orient = orient;

	addGhostPiece( type, orient, gx, gz, 0.4 );

	const neighbors = [ [ gx, gz - 1 ], [ gx, gz + 1 ], [ gx + 1, gz ], [ gx - 1, gz ] ];

	for ( const [ nx, nz ] of neighbors ) {

		const nKey = cellKey( nx, nz );
		const nCell = grid.get( nKey );
		if ( ! nCell ) continue;

		const nExits = getCellExits( nCell );
		const nConn = getConnectivityMask( nx, nz );
		const nConnected = nExits & nConn;

		const [ newType, newOrient ] = resolveTile( nx, nz );
		const proposedExits = getCellExits( { type: newType, orient: newOrient } );
		if ( ( proposedExits & nConnected ) !== nConnected ) continue;

		const finalType = nCell.isFinish && newType === 'track-straight' ? 'track-finish' : newType;

		if ( finalType !== nCell.type || newOrient !== nCell.orient ) {

			if ( nCell.mesh ) {

				nCell.mesh.visible = false;
				ghostNeighborBackups.push( { cell: nCell } );

			}

			addGhostPiece( finalType, newOrient, nx, nz, 0.7 );

		}

	}

	grid.delete( key );

}

export function clearGhost() {

	if ( eraseHoverCell ) {

		for ( const { mesh, mat } of eraseHoverOrigMaterials ) {

			mesh.material = mat;

		}

		eraseHoverOrigMaterials.length = 0;
		eraseHoverCell = null;

	}

	for ( const { cell } of ghostNeighborBackups ) {

		if ( cell.mesh ) cell.mesh.visible = true;

	}

	ghostNeighborBackups.length = 0;

	while ( ghostGroup.children.length > 0 ) {

		ghostGroup.remove( ghostGroup.children[ 0 ] );

	}

}
