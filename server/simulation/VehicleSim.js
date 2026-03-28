import { rigidBody } from 'crashcat';
import { ArcadeVehicle } from './ArcadeVehicle.js';
import { USE_ARCADE_VEHICLE } from './VehicleStats.js';
import { castWheelRay } from './PhysicsWorld.js';

const LINEAR_DAMP = 0.1;

function lerpAngle( a, b, t ) {

    let diff = b - a;
    while ( diff > Math.PI ) diff -= Math.PI * 2;
    while ( diff < -Math.PI ) diff += Math.PI * 2;
    return a + diff * t;

}

function clamp( v, min, max ) {

    return Math.max( min, Math.min( max, v ) );

}

function lerp( a, b, t ) {

    return a + ( b - a ) * t;

}

// Lightweight quaternion helpers (avoid Three.js dependency on server)
function quatFromAxisAngle( axis, angle ) {

    const s = Math.sin( angle / 2 );
    return [ axis[ 0 ] * s, axis[ 1 ] * s, axis[ 2 ] * s, Math.cos( angle / 2 ) ];

}

function quatMultiply( a, b ) {

    return [
        a[ 3 ] * b[ 0 ] + a[ 0 ] * b[ 3 ] + a[ 1 ] * b[ 2 ] - a[ 2 ] * b[ 1 ],
        a[ 3 ] * b[ 1 ] - a[ 0 ] * b[ 2 ] + a[ 1 ] * b[ 3 ] + a[ 2 ] * b[ 0 ],
        a[ 3 ] * b[ 2 ] + a[ 0 ] * b[ 1 ] - a[ 1 ] * b[ 0 ] + a[ 2 ] * b[ 3 ],
        a[ 3 ] * b[ 3 ] - a[ 0 ] * b[ 0 ] - a[ 1 ] * b[ 1 ] - a[ 2 ] * b[ 2 ],
    ];

}

function quatSlerp( a, b, t ) {

    let dot = a[ 0 ] * b[ 0 ] + a[ 1 ] * b[ 1 ] + a[ 2 ] * b[ 2 ] + a[ 3 ] * b[ 3 ];
    if ( dot < 0 ) { b = [ -b[ 0 ], -b[ 1 ], -b[ 2 ], -b[ 3 ] ]; dot = -dot; }
    if ( dot > 0.9995 ) {

        const r = [ a[ 0 ] + t * ( b[ 0 ] - a[ 0 ] ), a[ 1 ] + t * ( b[ 1 ] - a[ 1 ] ), a[ 2 ] + t * ( b[ 2 ] - a[ 2 ] ), a[ 3 ] + t * ( b[ 3 ] - a[ 3 ] ) ];
        const len = Math.sqrt( r[ 0 ] * r[ 0 ] + r[ 1 ] * r[ 1 ] + r[ 2 ] * r[ 2 ] + r[ 3 ] * r[ 3 ] );
        return [ r[ 0 ] / len, r[ 1 ] / len, r[ 2 ] / len, r[ 3 ] / len ];

    }

    const theta = Math.acos( dot );
    const sinTheta = Math.sin( theta );
    const wa = Math.sin( ( 1 - t ) * theta ) / sinTheta;
    const wb = Math.sin( t * theta ) / sinTheta;
    return [ wa * a[ 0 ] + wb * b[ 0 ], wa * a[ 1 ] + wb * b[ 1 ], wa * a[ 2 ] + wb * b[ 2 ], wa * a[ 3 ] + wb * b[ 3 ] ];

}

function applyQuatToVec3( q, v ) {

    const ix = q[ 3 ] * v[ 0 ] + q[ 1 ] * v[ 2 ] - q[ 2 ] * v[ 1 ];
    const iy = q[ 3 ] * v[ 1 ] + q[ 2 ] * v[ 0 ] - q[ 0 ] * v[ 2 ];
    const iz = q[ 3 ] * v[ 2 ] + q[ 0 ] * v[ 1 ] - q[ 1 ] * v[ 0 ];
    const iw = -q[ 0 ] * v[ 0 ] - q[ 1 ] * v[ 1 ] - q[ 2 ] * v[ 2 ];

    return [
        ix * q[ 3 ] + iw * -q[ 0 ] + iy * -q[ 2 ] - iz * -q[ 1 ],
        iy * q[ 3 ] + iw * -q[ 1 ] + iz * -q[ 0 ] - ix * -q[ 2 ],
        iz * q[ 3 ] + iw * -q[ 2 ] + ix * -q[ 1 ] - iy * -q[ 0 ],
    ];

}

function quatNormalize( q ) {

    const len = Math.sqrt( q[ 0 ] * q[ 0 ] + q[ 1 ] * q[ 1 ] + q[ 2 ] * q[ 2 ] + q[ 3 ] * q[ 3 ] );
    if ( len === 0 ) return [ 0, 0, 0, 1 ];
    return [ q[ 0 ] / len, q[ 1 ] / len, q[ 2 ] / len, q[ 3 ] / len ];

}

export class VehicleSim {

    constructor( world, spawnPos, spawnAngle, stats ) {

        this.world = world;
        this.body = null;

        // Vehicle-specific physics constants
        this._stats = stats || { maxSpeed: 1.0, accelRate: 6, steeringMult: 4.0, driveMult: 100 };

        this.linearSpeed = 0;
        this.angularSpeed = 0;
        this.acceleration = 0;

        this.spherePos = spawnPos ? [ ...spawnPos ] : [ 3.5, 0.5, 5 ];
        this.quat = quatFromAxisAngle( [ 0, 1, 0 ], spawnAngle || 0 );

        this.inputX = 0;
        this.inputZ = 0;
        this.touchActive = false;

        this.driftIntensity = 0;

        this.prevPosX = this.spherePos[ 0 ];
        this.prevPosZ = this.spherePos[ 2 ];
        this.modelVelX = 0;
        this.modelVelZ = 0;

        // Body tilt values (for drift intensity calc without Three.js)
        this.bodyRotZ = 0;

        // Arcade vehicle
        this._useArcade = USE_ARCADE_VEHICLE;
        this._arcadeVehicle = null;
        this._rayFilter = null;

        // Pre-allocated per-frame buffers
        this._chassisState = {
            position: [ 0, 0, 0 ],
            quaternion: [ 0, 0, 0, 1 ],
            linearVelocity: [ 0, 0, 0 ],
            angularVelocity: [ 0, 0, 0 ],
        };
        this._rayResults = [
            { hit: false, fraction: 1.0 },
            { hit: false, fraction: 1.0 },
            { hit: false, fraction: 1.0 },
            { hit: false, fraction: 1.0 },
        ];
        this._rayOrigin = [ 0, 0, 0 ];
        this._wheelWorldOff = [ 0, 0, 0 ];

        if ( this._useArcade ) {

            this._arcadeVehicle = new ArcadeVehicle( this._stats );

        }

    }

    setInput( input ) {

        this.inputX = input.x || 0;
        this.inputZ = input.z || 0;
        this.touchActive = !! input.touchActive;

    }

    // Phase 1: process inputs and apply driving forces BEFORE updateWorld()
    applyInput( dt ) {

        if ( dt <= 0 ) return;

        if ( this._useArcade ) {

            this._applyInputArcade( dt );

        } else {

            this._applyInputLegacy( dt );

        }

    }

    // ── Arcade vehicle input ─────────────────────────────────────

    _applyInputArcade( dt ) {

        let inputX = this.inputX;
        let inputZ = this.inputZ;

        let steer = 0, throttle = 0, brake = 0;

        if ( this.touchActive && ( inputX !== 0 || inputZ !== 0 ) ) {

            const targetAngle = Math.atan2( inputX, inputZ );
            const targetQuat = quatFromAxisAngle( [ 0, 1, 0 ], targetAngle );
            this.quat = quatSlerp( this.quat, targetQuat, 1 - Math.exp( -3 * dt ) );
            this.quat = quatNormalize( this.quat );

            const forward = applyQuatToVec3( this.quat, [ 0, 0, 1 ] );
            const cross = forward[ 0 ] * inputZ - forward[ 2 ] * inputX;
            steer = -cross * 2;
            throttle = 1.0;
            inputX = steer;

        } else {

            steer = inputX;
            throttle = Math.max( 0, inputZ );
            brake = Math.max( 0, -inputZ );

        }

        if ( ! this.body ) return;

        // Read chassis state into pre-allocated object
        const pos = this.body.position;
        const bquat = this.body.quaternion;
        const linVel = this.body.motionProperties.linearVelocity;
        const angVel = this.body.motionProperties.angularVelocity;

        const cs = this._chassisState;
        cs.position[ 0 ] = pos[ 0 ]; cs.position[ 1 ] = pos[ 1 ]; cs.position[ 2 ] = pos[ 2 ];
        cs.quaternion[ 0 ] = bquat[ 0 ]; cs.quaternion[ 1 ] = bquat[ 1 ]; cs.quaternion[ 2 ] = bquat[ 2 ]; cs.quaternion[ 3 ] = bquat[ 3 ];
        cs.linearVelocity[ 0 ] = linVel[ 0 ]; cs.linearVelocity[ 1 ] = linVel[ 1 ]; cs.linearVelocity[ 2 ] = linVel[ 2 ];
        cs.angularVelocity[ 0 ] = angVel[ 0 ]; cs.angularVelocity[ 1 ] = angVel[ 1 ]; cs.angularVelocity[ 2 ] = angVel[ 2 ];

        // 4 wheel raycasts (pre-allocated buffers, inline quat rotation)
        const cfg = this._stats;
        const rayLength = cfg.suspensionRestLength + cfg.wheelRadius + 0.25;
        const offsets = this._arcadeVehicle.wheelOffsets;
        const origin = this._rayOrigin;
        const woff = this._wheelWorldOff;
        const q = cs.quaternion;

        for ( let i = 0; i < 4; i++ ) {

            // Inline quaternion rotation (avoids applyQuatToVec3 allocation)
            const v = offsets[ i ];
            const ix = q[ 3 ] * v[ 0 ] + q[ 1 ] * v[ 2 ] - q[ 2 ] * v[ 1 ];
            const iy = q[ 3 ] * v[ 1 ] + q[ 2 ] * v[ 0 ] - q[ 0 ] * v[ 2 ];
            const iz = q[ 3 ] * v[ 2 ] + q[ 0 ] * v[ 1 ] - q[ 1 ] * v[ 0 ];
            const iw = -q[ 0 ] * v[ 0 ] - q[ 1 ] * v[ 1 ] - q[ 2 ] * v[ 2 ];
            origin[ 0 ] = pos[ 0 ] + ( ix * q[ 3 ] + iw * -q[ 0 ] + iy * -q[ 2 ] - iz * -q[ 1 ] );
            origin[ 1 ] = pos[ 1 ] + ( iy * q[ 3 ] + iw * -q[ 1 ] + iz * -q[ 0 ] - ix * -q[ 2 ] );
            origin[ 2 ] = pos[ 2 ] + ( iz * q[ 3 ] + iw * -q[ 2 ] + ix * -q[ 1 ] - iy * -q[ 0 ] );

            if ( this._rayFilter ) {

                const hit = castWheelRay( this.world, origin, rayLength, this._rayFilter );
                this._rayResults[ i ].hit = hit.hit;
                this._rayResults[ i ].fraction = hit.fraction;

            } else {

                this._rayResults[ i ].hit = false;
                this._rayResults[ i ].fraction = 1.0;

            }

        }

        // Run arcade vehicle physics
        const result = this._arcadeVehicle.update( dt, cs, { steer, throttle, brake }, this._rayResults );

        // Apply forces
        for ( let i = 0; i < result.forceCount; i++ ) {

            const f = result.forces[ i ];
            rigidBody.addForceAtPosition( this.world, this.body, f.force, f.position, true );

        }

        for ( let i = 0; i < result.torqueCount; i++ ) {

            rigidBody.addTorque( this.world, this.body, result.torques[ i ], true );

        }

        this.linearSpeed = result.linearSpeed;
        this.driftIntensity = result.driftIntensity;

        // Store processed inputX for client visuals
        this.inputX = inputX;

    }

    // ── Legacy sphere input ──────────────────────────────────────

    _applyInputLegacy( dt ) {

        let inputX = this.inputX;
        let inputZ = this.inputZ;

        if ( this.touchActive && ( inputX !== 0 || inputZ !== 0 ) ) {

            const targetAngle = Math.atan2( inputX, inputZ );
            const targetQuat = quatFromAxisAngle( [ 0, 1, 0 ], targetAngle );
            this.quat = quatSlerp( this.quat, targetQuat, 1 - Math.exp( -3 * dt ) );
            this.quat = quatNormalize( this.quat );

            const forward = applyQuatToVec3( this.quat, [ 0, 0, 1 ] );
            const cross = forward[ 0 ] * inputZ - forward[ 2 ] * inputX;
            inputX = -cross * 2;

            this.linearSpeed = lerp( this.linearSpeed, this._stats.maxSpeed, dt * this._stats.accelRate );

        } else {

            let direction = Math.sign( this.linearSpeed );
            if ( direction === 0 ) direction = Math.abs( inputZ ) > 0.1 ? Math.sign( inputZ ) : 1;

            const steeringGrip = clamp( Math.abs( this.linearSpeed ), 0.2, 1.0 );
            const targetAngular = -inputX * steeringGrip * this._stats.steeringMult * direction;
            this.angularSpeed = lerp( this.angularSpeed, targetAngular, dt * 4 );

            const rotQuat = quatFromAxisAngle( [ 0, 1, 0 ], this.angularSpeed * dt );
            this.quat = quatMultiply( this.quat, rotQuat );
            this.quat = quatNormalize( this.quat );

            const targetSpeed = inputZ * this._stats.maxSpeed;

            if ( targetSpeed < 0 && this.linearSpeed > 0.01 ) {

                this.linearSpeed = lerp( this.linearSpeed, 0.0, dt * 8 );

            } else if ( targetSpeed < 0 ) {

                this.linearSpeed = lerp( this.linearSpeed, targetSpeed / 2, dt * 2 );

            } else {

                this.linearSpeed = lerp( this.linearSpeed, targetSpeed, dt * this._stats.accelRate );

            }

        }

        this.linearSpeed *= Math.max( 0, 1 - LINEAR_DAMP * dt );

        if ( this.body ) {

            const right = applyQuatToVec3( this.quat, [ 1, 0, 0 ] );
            const rLen = Math.sqrt( right[ 0 ] * right[ 0 ] + right[ 2 ] * right[ 2 ] );
            const rx = rLen > 0 ? right[ 0 ] / rLen : 0;
            const rz = rLen > 0 ? right[ 2 ] / rLen : 0;

            const angvel = this.body.motionProperties.angularVelocity;
            const drive = this.linearSpeed * this._stats.driveMult * dt;

            rigidBody.setAngularVelocity( this.world, this.body, [
                angvel[ 0 ] + rx * drive,
                angvel[ 1 ],
                angvel[ 2 ] + rz * drive
            ] );

        }

        this.inputX = inputX;

    }

    // Phase 2: read authoritative position AFTER updateWorld(), compute derived values
    readBack( dt ) {

        if ( dt <= 0 ) return;

        if ( this.body ) {

            const pos = this.body.position;
            this.spherePos[ 0 ] = pos[ 0 ];
            this.spherePos[ 1 ] = pos[ 1 ];
            this.spherePos[ 2 ] = pos[ 2 ];

            if ( this._useArcade ) {

                // Read quaternion from chassis body directly
                const q = this.body.quaternion;
                this.quat = [ q[ 0 ], q[ 1 ], q[ 2 ], q[ 3 ] ];

            }

        }

        this.acceleration = lerp(
            this.acceleration,
            this.linearSpeed + ( 0.25 * this.linearSpeed * Math.abs( this.linearSpeed ) ),
            dt
        );

        // Fall reset
        if ( this.spherePos[ 1 ] < -10 ) {

            if ( this.body ) {

                rigidBody.setPosition( this.world, this.body, [ 3.5, 0.5, 5 ], false );
                rigidBody.setLinearVelocity( this.world, this.body, [ 0, 0, 0 ] );
                rigidBody.setAngularVelocity( this.world, this.body, [ 0, 0, 0 ] );

                if ( this._useArcade ) {

                    rigidBody.setQuaternion( this.world, this.body, [ 0, 0, 0, 1 ], false );

                }

            }

            this.spherePos[ 0 ] = 3.5;
            this.spherePos[ 1 ] = 0.5;
            this.spherePos[ 2 ] = 5;
            this.linearSpeed = 0;
            this.angularSpeed = 0;
            this.acceleration = 0;
            this.quat = [ 0, 0, 0, 1 ];

            if ( this._arcadeVehicle ) this._arcadeVehicle.reset();

        }

        // Model velocity for drift calc (legacy path)
        if ( ! this._useArcade ) {

            const modelX = this.spherePos[ 0 ];
            const modelZ = this.spherePos[ 2 ];
            this.modelVelX = ( modelX - this.prevPosX ) / dt;
            this.modelVelZ = ( modelZ - this.prevPosZ ) / dt;
            this.prevPosX = modelX;
            this.prevPosZ = modelZ;

            this.bodyRotZ = lerpAngle( this.bodyRotZ, -( this.inputX / 5 ) * this.linearSpeed, dt * 5 );
            this.driftIntensity = Math.abs( this.linearSpeed - this.acceleration ) +
                Math.abs( this.bodyRotZ ) * 2;

        }

    }

}
