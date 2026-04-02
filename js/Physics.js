// Physics.js — Client-side thin wrapper over shared/PhysicsFactory.js
// Injects crashcat API and adds Three.js debug visualization.

import * as THREE from 'three';
import * as crashcat from 'crashcat';
import { TRACK_CELLS } from './Track.js';
import {
	inject,
	buildColliders,
	createChassisBody,
	initRayFilter,
	castWheelRay
} from '../shared/PhysicsFactory.js';

// Inject crashcat into shared factory (single instance, no dual-package hazard)
inject( crashcat );

export { createChassisBody, initRayFilter, castWheelRay };

// ── Debug visualization ─────────────────────────────────────────────

const _debugMat = new THREE.MeshBasicMaterial( { color: 0x00ff00, wireframe: true } );

function addDebugBox( group, halfExtents, position, quaternion ) {

	const geo = new THREE.BoxGeometry( halfExtents[ 0 ] * 2, halfExtents[ 1 ] * 2, halfExtents[ 2 ] * 2 );
	const mesh = new THREE.Mesh( geo, _debugMat );
	mesh.position.set( position[ 0 ], position[ 1 ], position[ 2 ] );
	if ( quaternion ) mesh.quaternion.set( quaternion[ 0 ], quaternion[ 1 ], quaternion[ 2 ], quaternion[ 3 ] );
	group.add( mesh );

}

// ── Public API ──────────────────────────────────────────────────────

export function buildWallColliders( world, debugGroup, customCells ) {

	const cells = customCells || TRACK_CELLS;
	const onCollider = debugGroup
		? ( halfExtents, position, quaternion ) => addDebugBox( debugGroup, halfExtents, position, quaternion )
		: null;

	buildColliders( world, cells, onCollider );

}
