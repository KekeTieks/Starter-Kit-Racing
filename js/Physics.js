import * as THREE from 'three';
import { rigidBody, box, sphere, convexHull, MotionType, MotionQuality, castRay, createClosestCastRayCollector, createDefaultCastRaySettings, CastRayStatus, filter } from 'crashcat';
import { TRACK_CELLS, CELL_RAW, ORIENT_DEG, GRID_SCALE } from './Track.js';
import { parseCell } from './CellFormat.js';
import { CHASSIS_HALF_EXTENTS } from './VehicleStats.js';

const _debugMat = new THREE.MeshBasicMaterial( { color: 0x00ff00, wireframe: true } );

function addDebugBox( group, halfExtents, position, quaternion ) {

	const geo = new THREE.BoxGeometry( halfExtents[ 0 ] * 2, halfExtents[ 1 ] * 2, halfExtents[ 2 ] * 2 );
	const mesh = new THREE.Mesh( geo, _debugMat );
	mesh.position.set( position[ 0 ], position[ 1 ], position[ 2 ] );
	if ( quaternion ) mesh.quaternion.set( quaternion[ 0 ], quaternion[ 1 ], quaternion[ 2 ], quaternion[ 3 ] );
	group.add( mesh );

}

export function buildWallColliders( world, debugGroup, customCells ) {

	const wallBodies = new Set();
	const S = GRID_SCALE;
	const CELL_HALF = CELL_RAW / 2;

	const WALL_HALF_THICK = 0.25;
	const WALL_X = 4.75;
	const WALL_HALF_H = 1.5;

	const wallY = ( 0.5 + WALL_HALF_H ) * S - 0.5;
	const hThick = WALL_HALF_THICK * S;
	const hHeight = WALL_HALF_H * S;
	const hLen = CELL_HALF * S;

	const ARC_SPAN = - Math.PI / 2;
	const ARC_CENTER_X = - CELL_HALF;
	const ARC_CENTER_Z = CELL_HALF;
	const OUTER_R = 2 * CELL_HALF - WALL_HALF_THICK;
	const OUTER_SEG = 16;
	const OUTER_SEG_HALF_LEN = ( OUTER_R * ( Math.PI / 2 ) / OUTER_SEG / 2 ) * S;
	const INNER_R = WALL_HALF_THICK;
	const INNER_SEG = 3;
	const INNER_SEG_HALF_LEN = ( INNER_R * ( Math.PI / 2 ) / INNER_SEG / 2 ) * S;

	function addArcWall( wcx, wcz, arcStart, radius, numSeg, segHalfLen, cellMinX, cellMaxX, cellMinZ, cellMaxZ ) {

		for ( let i = 0; i < numSeg; i ++ ) {

			const aMid = arcStart + ( ( i + 0.5 ) / numSeg ) * ARC_SPAN;
			const px = wcx + radius * Math.cos( aMid ) * S;
			const pz = wcz + radius * Math.sin( aMid ) * S;

			// Skip segments outside cell bounds or at the arc endpoints (junction with adjacent cells)
			if ( px < cellMinX || px > cellMaxX || pz < cellMinZ || pz > cellMaxZ ) continue;
			if ( i === 0 || i === numSeg - 1 ) continue;

			const halfExtents = [ hThick, hHeight, segHalfLen ];
			const position = [ px, wallY, pz ];
			const quaternion = [ 0, Math.sin( - aMid / 2 ), 0, Math.cos( - aMid / 2 ) ];

			wallBodies.add( rigidBody.create( world, {
				shape: box.create( { halfExtents } ),
				motionType: MotionType.STATIC,
				objectLayer: world._OL_WALL,
				position,
				quaternion,
				friction: 0.0,
				restitution: 0.0,
			} ) );

			if ( debugGroup ) addDebugBox( debugGroup, halfExtents, position, quaternion );

		}

	}

	// Bump collider: two thin angled slabs matching the bump mesh surface
	// The bump GLB spans ~1.8 cells along travel, peaks at ~0.55 units above road surface.
	// Each ramp half covers 0.9 cells horizontally from edge to peak.
	const BUMP_HALF_W     = 3.5 * S;                    // half-width across travel (matches mesh)
	const BUMP_PEAK_H     = 0.55 * S;                   // height of the peak above road surface
	const BUMP_HORIZ_HALF = 0.9 * CELL_RAW * S;         // horizontal distance from center to edge of each ramp half
	const BUMP_SURFACE_HALF = Math.sqrt( BUMP_HORIZ_HALF ** 2 + BUMP_PEAK_H ** 2 ) / 2; // half-length along slope surface
	const BUMP_SLAB_H     = 0.08 * S;                   // slab thickness (normal to slope surface)
	const BUMP_RAMP_PITCH = Math.atan2( BUMP_PEAK_H, BUMP_HORIZ_HALF ); // ~3.5°
	// Center of each ramp half: midpoint along horizontal projection
	const BUMP_OFFSET_Z   = BUMP_HORIZ_HALF / 2;        // distance from cell center to midpoint of each half

	function addBumpCollider( cx, cz, bumpRad ) {

		const sinR = Math.sin( bumpRad ), cosR = Math.cos( bumpRad );
		const roadY = 0.5 * S - 0.5;

		for ( const sign of [ - 1, 1 ] ) {

			// sign=-1 → front ramp (approaching), sign=+1 → back ramp (leaving)
			// Offset along travel axis (bumpRad points along travel)
			const oz = sign * BUMP_OFFSET_Z;
			const wx = cx - oz * sinR;
			const wz = cz + oz * cosR;
			// Midpoint height: halfway up the ramp face.
			// Offset down by slab thickness so the TOP of the slab matches the mesh surface.
			const wy = roadY + BUMP_PEAK_H * 0.5 - BUMP_SLAB_H * Math.cos( BUMP_RAMP_PITCH );

			// Pitch tilts the slab to match ramp surface:
			// front half (sign=-1) tilts up toward center → negative pitch
			// back half (sign=+1) tilts down away from center → positive pitch
			const pitch = sign * BUMP_RAMP_PITCH;

			const qyaw   = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), bumpRad );
			const qpitch = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 1, 0, 0 ), pitch );
			const q = qyaw.clone().multiply( qpitch );

			const halfExtents = [ BUMP_HALF_W, BUMP_SLAB_H, BUMP_SURFACE_HALF ];
			const position    = [ wx, wy, wz ];
			const quaternion  = [ q.x, q.y, q.z, q.w ];

			wallBodies.add( rigidBody.create( world, {
				shape: box.create( { halfExtents } ),
				motionType: MotionType.STATIC,
				objectLayer: world._OL_WALL,
				position,
				quaternion,
				friction: 0.3,
				restitution: 0.0,
			} ) );

			if ( debugGroup ) addDebugBox( debugGroup, halfExtents, position, quaternion );

		}

	}

	function addRampCollider( cx, cz, rampRad, rampLength, rampAngle, rampWidth ) {

		// Build a convex hull matching buildRampMesh exactly (same vertex layout).
		// Geometry in world space: front (+Z local) is low, back (-Z local) is high.
		// The shape is built unrotated in local space, then placed with yaw only.
		const halfW  = ( CELL_RAW / 2 ) * S * rampWidth;
		const len    = rampLength * CELL_RAW * S * 0.5;   // half-length along travel axis
		const h      = Math.tan( rampAngle * Math.PI / 180 ) * len * 2; // total height rise
		const roadY  = 0.5 * S - 0.5;                     // world Y of the road surface

		// 6 vertices of the wedge (matching buildRampMesh, already in world scale):
		//   fl/fr = front-low (+Z, y=roadY)
		//   bl/br = back-low  (-Z, y=roadY)
		//   tl/tr = back-top  (-Z, y=roadY+h)
		// Shape is built at origin; position is applied to rigidBody.
		const positions = [
			- halfW, 0,    len,   // fl
			  halfW, 0,    len,   // fr
			- halfW, 0,  - len,   // bl
			  halfW, 0,  - len,   // br
			- halfW, h,  - len,   // tl
			  halfW, h,  - len,   // tr
		];

		const shape    = convexHull.create( { positions } );
		const qyaw     = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), rampRad );
		const position = [ cx, roadY, cz ];
		const quaternion = [ qyaw.x, qyaw.y, qyaw.z, qyaw.w ];

		wallBodies.add( rigidBody.create( world, {
			shape,
			motionType: MotionType.STATIC,
			objectLayer: world._OL_STATIC,
			position,
			quaternion,
			friction: 0.3,
			restitution: 0.0,
		} ) );

	}

	const cells = customCells || TRACK_CELLS;

	for ( const entry of cells ) {

		const { gx, gz, type, orient, isBump, bumpOrient, rampLength, rampAngle, rampWidth } = parseCell( entry );

		if ( type === 'track-bump' ) continue; // legacy guard

		const cx = ( gx + 0.5 ) * CELL_RAW * S;
		const cz = ( gz + 0.5 ) * CELL_RAW * S;

		const deg = ORIENT_DEG[ orient ] ?? 0;
		const rad = deg * Math.PI / 180;
		const cr = Math.cos( rad ), sr = Math.sin( rad );

		if ( type === 'track-straight' || type === 'track-finish' || type === 'track-ramp' ) {

			for ( const side of [ - 1, 1 ] ) {

				const lx = side * WALL_X;
				const wx = cx + ( lx * cr ) * S;
				const wz = cz + ( - lx * sr ) * S;
				const halfExtents = [ hThick, hHeight, hLen ];
				const position = [ wx, wallY, wz ];
				const quaternion = [ 0, Math.sin( rad / 2 ), 0, Math.cos( rad / 2 ) ];

				wallBodies.add( rigidBody.create( world, {
					shape: box.create( { halfExtents } ),
					motionType: MotionType.STATIC,
					objectLayer: world._OL_WALL,
					position,
					quaternion,
					friction: 0.0,
					restitution: 0.3,
				} ) );

				if ( debugGroup ) addDebugBox( debugGroup, halfExtents, position, quaternion );

			}

		} else if ( type === 'track-corner' ) {

			const wcx = cx + ( ARC_CENTER_X * cr + ARC_CENTER_Z * sr ) * S;
			const wcz = cz + ( - ARC_CENTER_X * sr + ARC_CENTER_Z * cr ) * S;
			const arcStart = - rad;
			const cellMinX = gx * CELL_RAW * S;
			const cellMaxX = ( gx + 1 ) * CELL_RAW * S;
			const cellMinZ = gz * CELL_RAW * S;
			const cellMaxZ = ( gz + 1 ) * CELL_RAW * S;

			addArcWall( wcx, wcz, arcStart, OUTER_R, OUTER_SEG, OUTER_SEG_HALF_LEN, cellMinX, cellMaxX, cellMinZ, cellMaxZ );

		}

		if ( type === 'track-ramp' ) {

			const rampRad = ( ORIENT_DEG[ orient ] ?? 0 ) * Math.PI / 180;
			addRampCollider( cx, cz, rampRad, rampLength, rampAngle, rampWidth );

		} else if ( isBump ) {

			const bumpRad = ( ORIENT_DEG[ bumpOrient ] ?? 0 ) * Math.PI / 180;
			addBumpCollider( cx, cz, bumpRad );

		}

	}

	// Attach wall body set to world for contact listener filtering
	world._wallBodies = wallBodies;

}

export function createKinematicSphereBody( world, spawnPos ) {

	return rigidBody.create( world, {
		shape: sphere.create( { radius: 0.5 } ),
		motionType: MotionType.KINEMATIC,
		objectLayer: world._OL_MOVING,
		position: spawnPos || [ 3.5, 0.5, 5 ],
		mass: 1000.0,
		friction: 0.0,
		restitution: 0.0, // no bounce — server doesn't simulate inter-vehicle collisions the same way
	} );

}

export function createSphereBody( world, spawnPos ) {

	const body = rigidBody.create( world, {
		shape: sphere.create( { radius: 0.5 } ),
		motionType: MotionType.DYNAMIC,
		objectLayer: world._OL_MOVING,
		position: spawnPos || [ 3.5, 0.5, 5 ],
		mass: 1000.0,
		friction: 5.0,
		restitution: 0.1,
		linearDamping: 0.1,
		angularDamping: 4.0,
		gravityFactor: 1.5,
		motionQuality: MotionQuality.LINEAR_CAST,
	} );

	return body;

}

// ── Arcade vehicle chassis (box body) ────────────────────────────

export function createChassisBody( world, spawnPos, config ) {

	return rigidBody.create( world, {
		shape: box.create( { halfExtents: CHASSIS_HALF_EXTENTS } ),
		motionType: MotionType.DYNAMIC,
		objectLayer: world._OL_MOVING,
		position: spawnPos || [ 3.5, 0.5, 5 ],
		mass: config.mass,
		friction: 0.3,
		restitution: 0.3,
		linearDamping: 0.05,
		angularDamping: 0.5,
		gravityFactor: 2.0,
		motionQuality: MotionQuality.LINEAR_CAST,
	} );

}

// ── Wheel raycast helper ─────────────────────────────────────────

const _wheelRayCollector = createClosestCastRayCollector();
const _wheelRaySettings = createDefaultCastRaySettings();

export function initRayFilter( world ) {

	const f = filter.create( world.settings.layers );
	filter.disableObjectLayer( f, world.settings.layers, world._OL_MOVING );
	filter.disableObjectLayer( f, world.settings.layers, world._OL_WALL );
	return f;

}

const _wheelRayResult = { hit: false, fraction: 1.0 };
const _wheelRayDown = [ 0, - 1, 0 ];

export function castWheelRay( world, origin, length, rayFilter ) {

	_wheelRayCollector.reset();
	castRay( world, _wheelRayCollector, _wheelRaySettings, origin, _wheelRayDown, length, rayFilter );

	if ( _wheelRayCollector.hit.status === CastRayStatus.COLLIDING ) {

		const frac = _wheelRayCollector.hit.fraction;

		// Validate: NaN or out-of-range fractions can produce unbounded suspension forces
		if ( isFinite( frac ) && frac >= 0 && frac <= 1 ) {

			_wheelRayResult.hit = true;
			_wheelRayResult.fraction = frac;

		} else {

			_wheelRayResult.hit = false;
			_wheelRayResult.fraction = 1.0;

		}

	} else {

		_wheelRayResult.hit = false;
		_wheelRayResult.fraction = 1.0;

	}

	return _wheelRayResult;

}
