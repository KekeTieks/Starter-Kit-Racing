import {
    createWorldSettings, createWorld,
    addBroadphaseLayer, addObjectLayer, enableCollision,
    registerAll, rigidBody, box, sphere,
    MotionType, MotionQuality,
    castRay, createClosestCastRayCollector, createDefaultCastRaySettings,
    CastRayStatus, filter
} from 'crashcat';
import { ORIENT_DEG, CELL_RAW, GRID_SCALE } from './TrackData.js';
import { CHASSIS_HALF_EXTENTS } from './VehicleStats.js';

export function initPhysics( cells ) {

    registerAll();

    const worldSettings = createWorldSettings();
    worldSettings.gravity = [ 0, -9.81, 0 ];

    const BPL_MOVING = addBroadphaseLayer( worldSettings );
    const BPL_STATIC = addBroadphaseLayer( worldSettings );
    const OL_MOVING = addObjectLayer( worldSettings, BPL_MOVING );
    const OL_STATIC = addObjectLayer( worldSettings, BPL_STATIC );

    enableCollision( worldSettings, OL_MOVING, OL_STATIC );
    enableCollision( worldSettings, OL_MOVING, OL_MOVING );

    const world = createWorld( worldSettings );
    world._OL_MOVING = OL_MOVING;
    world._OL_STATIC = OL_STATIC;

    // Build wall colliders
    buildWallColliders( world, cells );

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

export function createSphereBody( world, spawnPos ) {

    return rigidBody.create( world, {
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
    return f;

}

const _wheelRayResult = { hit: false, fraction: 1.0 };
const _wheelRayDown = [ 0, -1, 0 ];

export function castWheelRay( world, origin, length, rayFilter ) {

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

function buildWallColliders( world, cells ) {

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

    const ARC_SPAN = -Math.PI / 2;
    const ARC_CENTER_X = -CELL_HALF;
    const ARC_CENTER_Z = CELL_HALF;
    const OUTER_R = 2 * CELL_HALF - WALL_HALF_THICK;
    const OUTER_SEG = 16;
    const OUTER_SEG_HALF_LEN = ( OUTER_R * ( Math.PI / 2 ) / OUTER_SEG / 2 ) * S;
    const INNER_R = WALL_HALF_THICK;
    const INNER_SEG = 3;
    const INNER_SEG_HALF_LEN = ( INNER_R * ( Math.PI / 2 ) / INNER_SEG / 2 ) * S;

    function addArcWall( wcx, wcz, arcStart, radius, numSeg, segHalfLen ) {

        for ( let i = 0; i < numSeg; i++ ) {

            const aMid = arcStart + ( ( i + 0.5 ) / numSeg ) * ARC_SPAN;
            const halfExtents = [ hThick, hHeight, segHalfLen ];
            const position = [
                wcx + radius * Math.cos( aMid ) * S,
                wallY,
                wcz + radius * Math.sin( aMid ) * S
            ];
            const quaternion = [ 0, Math.sin( -aMid / 2 ), 0, Math.cos( -aMid / 2 ) ];

            wallBodies.add( rigidBody.create( world, {
                shape: box.create( { halfExtents } ),
                motionType: MotionType.STATIC,
                objectLayer: world._OL_STATIC,
                position,
                quaternion,
                friction: 0.0,
                restitution: 0.0,
            } ) );

        }

    }

    for ( const [ gx, gz, key, orient ] of cells ) {

        if ( key === 'track-bump' ) continue;

        const cx = ( gx + 0.5 ) * CELL_RAW * S;
        const cz = ( gz + 0.5 ) * CELL_RAW * S;

        const deg = ORIENT_DEG[ orient ] ?? 0;
        const rad = deg * Math.PI / 180;
        const cr = Math.cos( rad ), sr = Math.sin( rad );

        if ( key === 'track-straight' || key === 'track-finish' ) {

            for ( const side of [ -1, 1 ] ) {

                const lx = side * WALL_X;
                const wx = cx + ( lx * cr ) * S;
                const wz = cz + ( -lx * sr ) * S;

                wallBodies.add( rigidBody.create( world, {
                    shape: box.create( { halfExtents: [ hThick, hHeight, hLen ] } ),
                    motionType: MotionType.STATIC,
                    objectLayer: world._OL_STATIC,
                    position: [ wx, wallY, wz ],
                    quaternion: [ 0, Math.sin( rad / 2 ), 0, Math.cos( rad / 2 ) ],
                    friction: 0.0,
                    restitution: 0.3,
                } ) );

            }

        } else if ( key === 'track-corner' ) {

            const wcx = cx + ( ARC_CENTER_X * cr + ARC_CENTER_Z * sr ) * S;
            const wcz = cz + ( -ARC_CENTER_X * sr + ARC_CENTER_Z * cr ) * S;
            const arcStart = -rad;

            addArcWall( wcx, wcz, arcStart, OUTER_R, OUTER_SEG, OUTER_SEG_HALF_LEN );
            addArcWall( wcx, wcz, arcStart, INNER_R, INNER_SEG, INNER_SEG_HALF_LEN );

        }

    }

    // Attach wall body set to world for contact listener filtering
    world._wallBodies = wallBodies;

}

function computeBounds( cells ) {

    if ( ! cells || cells.length === 0 ) return { centerX: 0, centerZ: 0, halfWidth: 30, halfDepth: 30 };

    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for ( const [ gx, gz ] of cells ) {

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
