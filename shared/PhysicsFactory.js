// PhysicsFactory.js — Shared physics collider/raycast/body creation
// No direct crashcat import — receives crashcat API via inject() to avoid
// dual-package hazard when shared/ and server/ resolve different instances.

import { CELL_RAW, ORIENT_DEG, GRID_SCALE } from './TrackConstants.js';
import { parseCell } from './CellFormat.js';
import { CHASSIS_HALF_EXTENTS } from './VehicleStats.js';

// ── Crashcat API (injected at startup) ──────────────────────────────

let _cc = null;

export function inject( crashcatModule ) {

	_cc = crashcatModule;

}

// ── Inline quaternion multiply (no Three.js) ────────────────────────

function mulQuat( ax, ay, az, aw, bx, by, bz, bw ) {

	return [
		aw * bx + ax * bw + ay * bz - az * by,
		aw * by - ax * bz + ay * bw + az * bx,
		aw * bz + ax * by - ay * bx + az * bw,
		aw * bw - ax * bx - ay * by - az * bz,
	];

}

// ── Wall / bump / ramp collider builder ─────────────────────────────

export function buildColliders( world, cells, onCollider ) {

	const { rigidBody, box, MotionType } = _cc;
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

	function addBody( opts, halfExtents, position, quaternion ) {

		const body = rigidBody.create( world, opts );
		wallBodies.add( body );
		if ( onCollider ) onCollider( halfExtents, position, quaternion );
		return body;

	}

	function addArcWall( wcx, wcz, arcStart, radius, numSeg, segHalfLen, cellMinX, cellMaxX, cellMinZ, cellMaxZ ) {

		for ( let i = 0; i < numSeg; i ++ ) {

			const aMid = arcStart + ( ( i + 0.5 ) / numSeg ) * ARC_SPAN;
			const px = wcx + radius * Math.cos( aMid ) * S;
			const pz = wcz + radius * Math.sin( aMid ) * S;

			if ( px < cellMinX || px > cellMaxX || pz < cellMinZ || pz > cellMaxZ ) continue;
			if ( i === 0 || i === numSeg - 1 ) continue;

			const halfExtents = [ hThick, hHeight, segHalfLen ];
			const position = [ px, wallY, pz ];
			const quaternion = [ 0, Math.sin( - aMid / 2 ), 0, Math.cos( - aMid / 2 ) ];

			addBody( {
				shape: box.create( { halfExtents } ),
				motionType: MotionType.STATIC,
				objectLayer: world._OL_WALL,
				position,
				quaternion,
				friction: 0.0,
				restitution: 0.0,
			}, halfExtents, position, quaternion );

		}

	}

	// ── Bump collider constants ──────────────────────────────────
	const BUMP_HALF_W     = 3.5 * S;
	const BUMP_PEAK_H     = 0.55 * S;
	const BUMP_HORIZ_HALF = 0.9 * CELL_RAW * S;
	const BUMP_SURFACE_HALF = Math.sqrt( BUMP_HORIZ_HALF ** 2 + BUMP_PEAK_H ** 2 ) / 2;
	const BUMP_SLAB_H     = 0.08 * S;
	const BUMP_RAMP_PITCH = Math.atan2( BUMP_PEAK_H, BUMP_HORIZ_HALF );
	const BUMP_OFFSET_Z   = BUMP_HORIZ_HALF / 2;

	function addBumpCollider( cx, cz, bumpRad ) {

		const sinR = Math.sin( bumpRad ), cosR = Math.cos( bumpRad );
		const roadY = 0.5 * S - 0.5;

		for ( const sign of [ - 1, 1 ] ) {

			const oz = sign * BUMP_OFFSET_Z;
			const wx = cx - oz * sinR;
			const wz = cz + oz * cosR;
			const wy = roadY + BUMP_PEAK_H * 0.5 - BUMP_SLAB_H * Math.cos( BUMP_RAMP_PITCH );
			const pitch = sign * BUMP_RAMP_PITCH;

			const qyaw = [ 0, Math.sin( bumpRad / 2 ), 0, Math.cos( bumpRad / 2 ) ];
			const qp   = [ Math.sin( pitch / 2 ), 0, 0, Math.cos( pitch / 2 ) ];
			const qfull = mulQuat( ...qyaw, ...qp );

			const halfExtents = [ BUMP_HALF_W, BUMP_SLAB_H, BUMP_SURFACE_HALF ];
			const position    = [ wx, wy, wz ];

			addBody( {
				shape: box.create( { halfExtents } ),
				motionType: MotionType.STATIC,
				objectLayer: world._OL_WALL,
				position,
				quaternion: qfull,
				friction: 0.3,
				restitution: 0.0,
			}, halfExtents, position, qfull );

		}

	}

	function addRampCollider( cx, cz, rampRad, rampLength, rampAngle, rampWidth ) {

		const halfW      = ( CELL_RAW / 2 ) * S * rampWidth;
		const horizLen   = rampLength * CELL_RAW * S;
		const rampAngleR = rampAngle * Math.PI / 180;
		const peakH      = Math.tan( rampAngleR ) * horizLen;
		const roadY      = 0.5 * S - 0.5;

		// Single tilted slab covering the entire ramp surface.
		// The chassis convexRadius (0.1) rounds its corners enough to
		// slide over the slab edge at the entry without snagging.
		const surfaceHalf = Math.sqrt( horizLen * horizLen + peakH * peakH ) / 2;
		const slabH       = 0.05;

		const wy = roadY + peakH * 0.5 - slabH * Math.cos( rampAngleR );
		const pitch = rampAngleR;

		const qyaw  = [ 0, Math.sin( rampRad / 2 ), 0, Math.cos( rampRad / 2 ) ];
		const qp    = [ Math.sin( pitch / 2 ), 0, 0, Math.cos( pitch / 2 ) ];
		const qfull = mulQuat( ...qyaw, ...qp );

		const halfExtents = [ halfW, slabH, surfaceHalf ];
		const position    = [ cx, wy, cz ];

		addBody( {
			shape: box.create( { halfExtents, convexRadius: 0.08 } ),
			motionType: MotionType.STATIC,
			objectLayer: world._OL_STATIC,
			position,
			quaternion: qfull,
			friction: 0.0,
			restitution: 0.0,
		}, halfExtents, position, qfull );

	}

	// ── Main loop ───────────────────────────────────────────────

	for ( const entry of cells ) {

		const { gx, gz, type, orient, isBump, bumpOrient, rampLength, rampAngle, rampWidth } = parseCell( entry );

		if ( type === 'track-bump' ) continue;

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

				addBody( {
					shape: box.create( { halfExtents } ),
					motionType: MotionType.STATIC,
					objectLayer: world._OL_WALL,
					position,
					quaternion,
					friction: 0.0,
					restitution: 0.3,
				}, halfExtents, position, quaternion );

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

	world._wallBodies = wallBodies;

}

// ── Body factories ──────────────────────────────────────────────────

export function createChassisBody( world, spawnPos, config ) {

	const { rigidBody, box, MotionType, MotionQuality } = _cc;

	return rigidBody.create( world, {
		shape: box.create( { halfExtents: CHASSIS_HALF_EXTENTS, convexRadius: 0.1 } ),
		motionType: MotionType.DYNAMIC,
		objectLayer: world._OL_MOVING,
		position: spawnPos || [ 3.5, 0.5, 5 ],
		mass: config.mass,
		friction: config.friction ?? 0.3,
		restitution: config.restitution ?? 0.3,
		linearDamping: config.linearDamping ?? 0.05,
		angularDamping: config.angularDamping ?? 0.5,
		gravityFactor: config.gravityFactor ?? 2.0,
		motionQuality: MotionQuality.LINEAR_CAST,
	} );

}

// ── Wheel raycast ───────────────────────────────────────────────────

let _wheelRayCollector = null;
let _wheelRaySettings = null;

export function initRayFilter( world ) {

	const { filter: f, createClosestCastRayCollector, createDefaultCastRaySettings } = _cc;

	// Lazy-init raycast singletons on first use
	if ( ! _wheelRayCollector ) {

		_wheelRayCollector = createClosestCastRayCollector();
		_wheelRaySettings = createDefaultCastRaySettings();

	}

	const rf = f.create( world.settings.layers );
	f.disableObjectLayer( rf, world.settings.layers, world._OL_MOVING );
	f.disableObjectLayer( rf, world.settings.layers, world._OL_WALL );
	return rf;

}

const _wheelRayResult = { hit: false, fraction: 1.0 };
const _wheelRayDown = [ 0, - 1, 0 ];

export function castWheelRay( world, origin, length, rayFilter ) {

	const { castRay, CastRayStatus } = _cc;

	_wheelRayCollector.reset();
	castRay( world, _wheelRayCollector, _wheelRaySettings, origin, _wheelRayDown, length, rayFilter );

	if ( _wheelRayCollector.hit.status === CastRayStatus.COLLIDING ) {

		const frac = _wheelRayCollector.hit.fraction;

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
