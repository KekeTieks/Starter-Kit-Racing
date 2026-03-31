import * as THREE from 'three';
import { parseCell } from './CellFormat.js';

export const ORIENT_DEG = { 0: 0, 10: 180, 16: 90, 22: 270 };

export const CELL_RAW = 9.99;
export const GRID_SCALE = 0.75;

// Build a procedural ramp mesh (wedge shape, front=low, back=high)
// The vehicle approaches from +Z (front) and rises toward -Z (back).
export function buildRampMesh( rampLength, rampAngle, rampWidth ) {

	// Geometry is in the trackGroup's local space (before scale=0.75 is applied),
	// so use CELL_RAW without GRID_SCALE — matching how GLB pieces are positioned.
	const cellSize = CELL_RAW;

	const halfW = ( cellSize / 2 ) * rampWidth;
	const len   = rampLength * cellSize * 0.5; // half-length along travel axis
	const h     = Math.tan( rampAngle * Math.PI / 180 ) * len * 2; // total height rise

	// 6 unique vertices of the wedge:
	//   fl/fr = front-low,  bl/br = back-low,  tl/tr = back-top
	//   Z axis = travel direction; front (+Z) is low, back (-Z) is high
	const fl = [ - halfW, 0,   len ];  // 0
	const fr = [   halfW, 0,   len ];  // 1
	const bl = [ - halfW, 0,  -len ];  // 2
	const br = [   halfW, 0,  -len ];  // 3
	const tl = [ - halfW, h,  -len ];  // 4
	const tr = [   halfW, h,  -len ];  // 5

	// Flat vertex array (unindexed for computeVertexNormals per-face)
	const verts = [
		// bottom  (winding: viewed from below → CCW = normal down)
		...fl, ...br, ...fr,
		...fl, ...bl, ...br,
		// ramp surface  (normal up-forward)
		...fl, ...fr, ...tr,
		...fl, ...tr, ...tl,
		// back wall
		...bl, ...tl, ...tr,
		...bl, ...tr, ...br,
		// left wall  (triangle: fl-tl-bl)
		...fl, ...tl, ...bl,
		// right wall  (triangle: fr-br-tr)
		...fr, ...br, ...tr,
	];

	const geo = new THREE.BufferGeometry();
	geo.setAttribute( 'position', new THREE.Float32BufferAttribute( verts, 3 ) );
	geo.computeVertexNormals();

	const mat = new THREE.MeshStandardMaterial( { color: 0xcc8833, roughness: 0.8, metalness: 0.0 } );
	const mesh = new THREE.Mesh( geo, mat );
	mesh.castShadow = true;
	mesh.receiveShadow = true;

	return mesh;

}

const _dummy = new THREE.Object3D();

export const TRACK_CELLS = [
	[ -3, -3, 'track-corner',   16 ],
	[ -2, -3, 'track-straight', 22 ],
	[ -1, -3, 'track-straight', 22 ],
	[  0, -3, 'track-corner',    0 ],
	[ -3, -2, 'track-straight',  0 ],
	[  0, -2, 'track-straight',  0 ],
	[ -3, -1, 'track-corner',   10 ],
	[ -2, -1, 'track-corner',    0 ],
	[  0, -1, 'track-straight',  0 ],
	[ -2,  0, 'track-straight', 10 ],
	[  0,  0, 'track-finish',    0 ],
	[ -2,  1, 'track-straight', 10 ],
	[  0,  1, 'track-straight',  0 ],
	[ -2,  2, 'track-corner',   10 ],
	[ -1,  2, 'track-straight', 16 ],
	[  0,  2, 'track-corner',   22 ],
];

const DECO_CELLS = [
	[ -4, -2, 'decoration-tents', 10 ],
	[ -1, -4, 'decoration-tents', 22 ],
	[ -1,  1, 'decoration-tents', 22 ],
	[ -8, -9, 'decoration-forest', 0 ], [ -7, -9, 'decoration-forest', 0 ],
	[ -6, -9, 'decoration-forest', 0 ], [ -5, -9, 'decoration-forest', 0 ],
	[ -4, -9, 'decoration-forest', 0 ], [ -3, -9, 'decoration-forest', 0 ],
	[ -2, -9, 'decoration-forest', 0 ], [ -1, -9, 'decoration-forest', 0 ],
	[  0, -9, 'decoration-forest', 0 ], [  1, -9, 'decoration-forest', 0 ],
	[  2, -9, 'decoration-forest', 0 ],
	[ -8, -8, 'decoration-forest', 0 ], [ -7, -8, 'decoration-forest', 0 ],
	[ -6, -8, 'decoration-forest', 0 ], [ -5, -8, 'decoration-forest', 0 ],
	[ -4, -8, 'decoration-forest', 0 ], [ -3, -8, 'decoration-forest', 0 ],
	[ -2, -8, 'decoration-forest', 0 ], [ -1, -8, 'decoration-forest', 0 ],
	[  0, -8, 'decoration-forest', 0 ], [  1, -8, 'decoration-forest', 0 ],
	[  2, -8, 'decoration-forest', 0 ],
	[ -8, -7, 'decoration-forest', 0 ], [ -7, -7, 'decoration-forest', 0 ],
	[ -6, -7, 'decoration-forest', 0 ], [ -5, -7, 'decoration-forest', 0 ],
	[ -4, -7, 'decoration-forest', 0 ], [ -3, -7, 'decoration-forest', 0 ],
	[ -2, -7, 'decoration-forest', 0 ], [ -1, -7, 'decoration-forest', 0 ],
	[  0, -7, 'decoration-forest', 0 ], [  1, -7, 'decoration-forest', 0 ],
	[  2, -7, 'decoration-forest', 0 ],
	[ -8, -6, 'decoration-forest', 0 ], [ -7, -6, 'decoration-forest', 0 ],
	[ -6, -6, 'decoration-forest', 0 ], [ -5, -6, 'decoration-forest', 0 ],
	[ -4, -6, 'decoration-forest', 0 ], [ -3, -6, 'decoration-empty', 0 ],
	[ -2, -6, 'decoration-empty', 0 ],  [ -1, -6, 'decoration-empty', 0 ],
	[  0, -6, 'decoration-empty', 0 ],  [  1, -6, 'decoration-forest', 0 ],
	[  2, -6, 'decoration-forest', 0 ],
	[ -8, -5, 'decoration-forest', 0 ], [ -7, -5, 'decoration-forest', 0 ],
	[ -6, -5, 'decoration-forest', 0 ], [ -5, -5, 'decoration-forest', 0 ],
	[ -4, -5, 'decoration-empty', 0 ],  [ -3, -5, 'decoration-empty', 0 ],
	[ -2, -5, 'decoration-empty', 0 ],  [ -1, -5, 'decoration-empty', 0 ],
	[  0, -5, 'decoration-empty', 0 ],  [  1, -5, 'decoration-forest', 0 ],
	[  2, -5, 'decoration-forest', 0 ],
	[ -8, -4, 'decoration-forest', 0 ], [ -7, -4, 'decoration-forest', 0 ],
	[ -6, -4, 'decoration-forest', 0 ], [ -5, -4, 'decoration-forest', 0 ],
	[ -4, -4, 'decoration-empty', 0 ],
	[  1, -4, 'decoration-forest', 0 ],
	[  2, -4, 'decoration-forest', 0 ],
	[ -8, -3, 'decoration-forest', 0 ], [ -7, -3, 'decoration-forest', 0 ],
	[ -6, -3, 'decoration-forest', 0 ], [ -5, -3, 'decoration-forest', 0 ],
	[ -4, -3, 'decoration-empty', 0 ],
	[  1, -3, 'decoration-forest', 0 ],
	[  2, -3, 'decoration-forest', 0 ],
	[ -8, -2, 'decoration-forest', 0 ], [ -7, -2, 'decoration-forest', 0 ],
	[ -6, -2, 'decoration-forest', 0 ], [ -5, -2, 'decoration-forest', 0 ],
	[  1, -2, 'decoration-forest', 0 ],
	[  2, -2, 'decoration-forest', 0 ],
	[ -8, -1, 'decoration-forest', 0 ], [ -7, -1, 'decoration-forest', 0 ],
	[ -6, -1, 'decoration-forest', 0 ], [ -5, -1, 'decoration-forest', 0 ],
	[ -4, -1, 'decoration-empty', 0 ],  [ -1, -1, 'decoration-empty', 0 ],
	[  1, -1, 'decoration-forest', 0 ],
	[  2, -1, 'decoration-forest', 0 ],
	[ -8,  0, 'decoration-forest', 0 ], [ -7,  0, 'decoration-forest', 0 ],
	[ -6,  0, 'decoration-forest', 0 ], [ -5,  0, 'decoration-forest', 0 ],
	[ -4,  0, 'decoration-empty', 0 ],  [ -3,  0, 'decoration-empty', 0 ],
	[ -1,  0, 'decoration-empty', 0 ],
	[  1,  0, 'decoration-forest', 0 ],
	[  2,  0, 'decoration-forest', 0 ],
	[ -8,  1, 'decoration-forest', 0 ], [ -7,  1, 'decoration-forest', 0 ],
	[ -6,  1, 'decoration-forest', 0 ], [ -5,  1, 'decoration-forest', 0 ],
	[ -4,  1, 'decoration-empty', 0 ],  [ -3,  1, 'decoration-empty', 0 ],
	[  1,  1, 'decoration-forest', 0 ],
	[  2,  1, 'decoration-forest', 0 ],
	[ -8,  2, 'decoration-forest', 0 ], [ -7,  2, 'decoration-forest', 0 ],
	[ -6,  2, 'decoration-forest', 0 ], [ -5,  2, 'decoration-forest', 0 ],
	[ -4,  2, 'decoration-empty', 0 ],  [ -3,  2, 'decoration-empty', 0 ],
	[  1,  2, 'decoration-forest', 0 ],
	[  2,  2, 'decoration-forest', 0 ],
	[ -8,  3, 'decoration-forest', 0 ], [ -7,  3, 'decoration-forest', 0 ],
	[ -6,  3, 'decoration-forest', 0 ], [ -5,  3, 'decoration-forest', 0 ],
	[ -4,  3, 'decoration-forest', 0 ], [ -3,  3, 'decoration-forest', 0 ],
	[ -2,  3, 'decoration-forest', 0 ], [ -1,  3, 'decoration-forest', 0 ],
	[  0,  3, 'decoration-forest', 0 ], [  1,  3, 'decoration-forest', 0 ],
	[  2,  3, 'decoration-forest', 0 ],
	[ -8,  4, 'decoration-forest', 0 ], [ -7,  4, 'decoration-forest', 0 ],
	[ -6,  4, 'decoration-forest', 0 ], [ -5,  4, 'decoration-forest', 0 ],
	[ -4,  4, 'decoration-forest', 0 ], [ -3,  4, 'decoration-forest', 0 ],
	[ -2,  4, 'decoration-forest', 0 ], [ -1,  4, 'decoration-forest', 0 ],
	[  0,  4, 'decoration-forest', 0 ], [  1,  4, 'decoration-forest', 0 ],
	[  2,  4, 'decoration-forest', 0 ],
];

const NPC_TRUCKS = [
	[ 'vehicle-truck-green',  -3.51, -0.01,  12.70,  98.0 ],
	[ 'vehicle-truck-purple', -23.78, -0.14, -13.56,   0.0 ],
	[ 'vehicle-truck-red',    -1.36, -0.15, -23.80, 155.9 ],
];

export function buildTrack( scene, models, customCells ) {

	const trackGroup = new THREE.Group();
	trackGroup.position.y = -0.5;

	const trackPieceGroup = new THREE.Group();
	const decoGroup = new THREE.Group();

	const cells = customCells || TRACK_CELLS;

	for ( const entry of cells ) {

		const { gx, gz, type, orient, isBump, bumpOrient, rampLength, rampAngle, rampWidth } = parseCell( entry );

		// For track-ramp: render a road straight underneath + ramp mesh on top
		const renderKey = type === 'track-ramp' ? 'track-straight' : type;
		const piece = placePiece( models, renderKey, gx, gz, orient );
		if ( piece ) trackPieceGroup.add( piece );

		if ( type === 'track-ramp' ) {

			const rampMesh = buildRampMesh( rampLength, rampAngle, rampWidth );
			const deg = ORIENT_DEG[ orient ] ?? 0;
			rampMesh.position.set( ( gx + 0.5 ) * CELL_RAW, 0.5, ( gz + 0.5 ) * CELL_RAW );
			rampMesh.rotation.y = THREE.MathUtils.degToRad( deg );
			trackPieceGroup.add( rampMesh );
			continue;

		}

		if ( isBump ) {

			const bump = placePiece( models, 'track-bump', gx, gz, bumpOrient );
			if ( bump ) trackPieceGroup.add( bump );

		}

	}

	if ( ! customCells ) {

		// Place hand-authored decorations for the default track
		for ( const [ gx, gz, key, orient ] of DECO_CELLS ) {

			const piece = placePiece( models, key, gx, gz, orient );
			if ( piece ) decoGroup.add( piece );

		}

	}

	{

		// Auto-generate decorations to fill any gaps
		const occupied = new Set();
		let minX = Infinity, maxX = - Infinity;
		let minZ = Infinity, maxZ = - Infinity;

		for ( const entry of cells ) {

			const { gx, gz } = parseCell( entry );
			occupied.add( gx + ',' + gz );
			minX = Math.min( minX, gx );
			maxX = Math.max( maxX, gx );
			minZ = Math.min( minZ, gz );
			maxZ = Math.max( maxZ, gz );

		}

		// Also mark existing decoration cells as occupied
		if ( ! customCells ) {

			for ( const [ gx, gz ] of DECO_CELLS ) {

				occupied.add( gx + ',' + gz );
				minX = Math.min( minX, gx );
				maxX = Math.max( maxX, gx );
				minZ = Math.min( minZ, gz );
				maxZ = Math.max( maxZ, gz );

			}

		}

		const pad = 3;
		const emptyPositions = [];
		const forestPositions = [];
		const tentPositions = [];

		// Simple hash for deterministic pseudo-random placement
		function hash( gx, gz ) {

			let h = gx * 374761393 + gz * 668265263;
			h = ( h ^ ( h >> 13 ) ) * 1274126177;
			return ( h ^ ( h >> 16 ) ) >>> 0;

		}

		for ( let gz = minZ - pad; gz <= maxZ + pad; gz ++ ) {

			for ( let gx = minX - pad; gx <= maxX + pad; gx ++ ) {

				if ( occupied.has( gx + ',' + gz ) ) continue;

				const distX = gx < minX ? minX - gx : gx > maxX ? gx - maxX : 0;
				const distZ = gz < minZ ? minZ - gz : gz > maxZ ? gz - maxZ : 0;
				const dist = Math.max( distX, distZ );

				const x = ( gx + 0.5 ) * CELL_RAW;
				const z = ( gz + 0.5 ) * CELL_RAW;

				if ( dist <= 1 ) {

					// ~15% chance of tents in the empty ring
					if ( hash( gx, gz ) % 7 === 0 ) {

						tentPositions.push( x, z, hash( gx, gz ) % 4 );

					} else {

						emptyPositions.push( x, z );

					}

				} else {

					forestPositions.push( x, z );

				}

			}

		}

		function createInstances( src, positions ) {

			if ( positions.length === 0 || ! src ) return;

			const count = positions.length / 2;

			src.traverse( ( child ) => {

				if ( ! child.isMesh ) return;

				const inst = new THREE.InstancedMesh( child.geometry, child.material, count );
				inst.castShadow = true;
				inst.receiveShadow = true;

				for ( let i = 0; i < count; i ++ ) {

					_dummy.position.set( positions[ i * 2 ], 0.5, positions[ i * 2 + 1 ] );
					_dummy.updateMatrix();
					inst.setMatrixAt( i, _dummy.matrix );

				}

				decoGroup.add( inst );

			} );

		}

		createInstances( models[ 'decoration-empty' ], emptyPositions );
		createInstances( models[ 'decoration-forest' ], forestPositions );

		// Place tents with random rotations
		const tentSrc = models[ 'decoration-tents' ];

		if ( tentSrc && tentPositions.length > 0 ) {

			const tentCount = tentPositions.length / 3;

			tentSrc.traverse( ( child ) => {

				if ( ! child.isMesh ) return;

				const inst = new THREE.InstancedMesh( child.geometry, child.material, tentCount );
				inst.castShadow = true;
				inst.receiveShadow = true;

				for ( let i = 0; i < tentCount; i ++ ) {

					_dummy.position.set( tentPositions[ i * 3 ], 0.5, tentPositions[ i * 3 + 1 ] );
					_dummy.rotation.y = tentPositions[ i * 3 + 2 ] * Math.PI / 2;
					_dummy.updateMatrix();
					inst.setMatrixAt( i, _dummy.matrix );

				}

				decoGroup.add( inst );

			} );

		}

	}

	trackGroup.add( trackPieceGroup );
	trackGroup.add( decoGroup );

	trackGroup.scale.setScalar( 0.75 );
	scene.add( trackGroup );

	trackGroup.updateMatrixWorld( true );

	trackGroup.traverse( ( child ) => {

		if ( child.isMesh ) {

			child.castShadow = true;
			child.receiveShadow = true;

		}

	} );

	const sceneObjects = [ trackGroup ];

	if ( ! customCells ) {

		for ( const [ key, x, y, z, rotDeg ] of NPC_TRUCKS ) {

			const src = models[ key ];
			if ( ! src ) continue;

			const npc = src.clone();
			npc.position.set( x, y, z );
			npc.rotation.y = THREE.MathUtils.degToRad( rotDeg + 180 );
			npc.traverse( ( c ) => {

				if ( c.isMesh ) {

					c.castShadow = true;
					c.receiveShadow = true;

				}

			} );
			scene.add( npc );
			sceneObjects.push( npc );

		}

	}

	return sceneObjects;

}

export function placePiece( models, key, gx, gz, orient ) {

	const src = models[ key ];
	if ( ! src ) return null;

	const piece = src.clone();
	piece.position.set( ( gx + 0.5 ) * CELL_RAW, 0.5, ( gz + 0.5 ) * CELL_RAW );

	const deg = ORIENT_DEG[ orient ] ?? 0;
	piece.rotation.y = THREE.MathUtils.degToRad( deg );

	return piece;

}


export function computeSpawnPosition( cells ) {

	let found = null;

	for ( const entry of cells ) {

		const c = parseCell( entry );
		if ( c.type === 'track-finish' ) { found = c; break; }

	}

	if ( ! found ) found = parseCell( cells[ 0 ] );
	if ( ! found ) return { position: [ 3.5, 0.5, 5 ], angle: 0 };

	const x = ( found.gx + 0.5 ) * CELL_RAW * GRID_SCALE;
	const z = ( found.gz + 0.5 ) * CELL_RAW * GRID_SCALE;
	const angle = THREE.MathUtils.degToRad( ORIENT_DEG[ found.orient ] || 0 );

	return { position: [ x, 0.5, z ], angle };

}

export function computeTrackBounds( cells ) {

	if ( ! cells || cells.length === 0 ) return { centerX: 0, centerZ: 0, halfWidth: 30, halfDepth: 30 };

	let minX = Infinity, maxX = - Infinity;
	let minZ = Infinity, maxZ = - Infinity;

	for ( const entry of cells ) {

		const { gx, gz } = parseCell( entry );
		minX = Math.min( minX, gx );
		maxX = Math.max( maxX, gx );
		minZ = Math.min( minZ, gz );
		maxZ = Math.max( maxZ, gz );

	}

	const S = CELL_RAW * GRID_SCALE;
	const centerX = ( minX + maxX + 1 ) / 2 * S;
	const centerZ = ( minZ + maxZ + 1 ) / 2 * S;
	const halfWidth = ( maxX - minX + 1 ) / 2 * S + S;
	const halfDepth = ( maxZ - minZ + 1 ) / 2 * S + S;

	return { centerX, centerZ, halfWidth, halfDepth };

}

