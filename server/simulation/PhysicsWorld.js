// PhysicsWorld.js — Server-side thin wrapper over shared/PhysicsFactory.js
// Injects crashcat API and creates the world + ground plane.

import * as crashcat from 'crashcat';
import { parseCell } from '../../shared/CellFormat.js';
import { CELL_RAW, GRID_SCALE } from '../../shared/TrackConstants.js';
import {
	inject,
	buildColliders,
	createChassisBody,
	initRayFilter,
	castWheelRay
} from '../../shared/PhysicsFactory.js';

const {
	createWorldSettings, createWorld,
	addBroadphaseLayer, addObjectLayer, enableCollision,
	registerAll, rigidBody, box, MotionType,
} = crashcat;

// Inject crashcat into shared factory (single instance, no dual-package hazard)
inject( crashcat );

export { createChassisBody, initRayFilter, castWheelRay };

export function initPhysics( cells ) {

	registerAll();

	const worldSettings = createWorldSettings();
	worldSettings.gravity = [ 0, -9.81, 0 ];

	const BPL_MOVING = addBroadphaseLayer( worldSettings );
	const BPL_STATIC = addBroadphaseLayer( worldSettings );
	const OL_MOVING = addObjectLayer( worldSettings, BPL_MOVING );
	const OL_STATIC = addObjectLayer( worldSettings, BPL_STATIC );
	const OL_WALL   = addObjectLayer( worldSettings, BPL_STATIC );

	enableCollision( worldSettings, OL_MOVING, OL_STATIC );
	enableCollision( worldSettings, OL_MOVING, OL_MOVING );
	enableCollision( worldSettings, OL_MOVING, OL_WALL );

	const world = createWorld( worldSettings );
	world._OL_MOVING = OL_MOVING;
	world._OL_STATIC = OL_STATIC;
	world._OL_WALL   = OL_WALL;

	// Build wall / bump / ramp colliders via shared factory
	buildColliders( world, cells, null );

	// Ground plane
	const bounds = computeBounds( cells );
	const groundSize = Math.max( bounds.halfWidth, bounds.halfDepth ) * 2 + 20;
	const roadHalf = groundSize / 2;

	rigidBody.create( world, {
		shape: box.create( { halfExtents: [ roadHalf, 0.01, roadHalf ] } ),
		motionType: MotionType.STATIC,
		objectLayer: OL_STATIC,
		position: [ bounds.centerX, -0.125, bounds.centerZ ],
		friction: 5.0,
		restitution: 0.0,
	} );

	return world;

}

function computeBounds( cells ) {

	if ( ! cells || cells.length === 0 ) return { centerX: 0, centerZ: 0, halfWidth: 30, halfDepth: 30 };

	let minX = Infinity, maxX = -Infinity;
	let minZ = Infinity, maxZ = -Infinity;

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
