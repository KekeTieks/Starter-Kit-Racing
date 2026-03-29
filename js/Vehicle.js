import * as THREE from 'three';
import { rigidBody } from 'crashcat';
import { ArcadeVehicle } from './ArcadeVehicle.js';
import { USE_ARCADE_VEHICLE } from './VehicleStats.js';
import { castWheelRay } from './Physics.js';
import { applyCosmetics, stripCosmetics } from './CosmeticApplicator.js';

const _tmpVec = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _zAxis = new THREE.Vector3();
const _newZ = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _currQ = new THREE.Quaternion();
const _up = new THREE.Vector3( 0, 1, 0 );

const LINEAR_DAMP = 0.1;

// Fallback anchor nodes used when the GLB has no headlight_* nodes yet.
// Positions are in container space (GLB model space × scale 0.5).
// Values derived from green truck GLB: front z=1.512, rear z=-1.326 in model space.
const _FALLBACK_FRONT = [
	new THREE.Vector3( -0.151, 0.297, 0.756 ),
	new THREE.Vector3(  0.150, 0.297, 0.756 ),
];
const _FALLBACK_REAR = [
	new THREE.Vector3( -0.196, 0.398, -0.663 ),
	new THREE.Vector3(  0.196, 0.398, -0.663 ),
];

function _makeFallbackNodes( anchors, container ) {

	return anchors.map( ( pos ) => {

		const obj = new THREE.Object3D();
		obj.position.copy( pos );
		container.add( obj );
		return obj;

	} );

}

function lerpAngle( a, b, t ) {

	let diff = b - a;
	while ( diff > Math.PI ) diff -= Math.PI * 2;
	while ( diff < -Math.PI ) diff += Math.PI * 2;
	return a + diff * t;

}

export class Vehicle {

	constructor( stats ) {

		// Vehicle-specific physics constants (from VehicleStats)
		this._stats = stats || { maxSpeed: 1.0, accelRate: 6, steeringMult: 4.0, driveMult: 100 };

		this.linearSpeed = 0;
		this.angularSpeed = 0;
		this.acceleration = 0;

		this.spherePos = new THREE.Vector3( 3.5, 0.5, 5 );
		this.sphereVel = new THREE.Vector3();

		this.rigidBody = null;
		this.physicsWorld = null;

		this.modelVelocity = new THREE.Vector3();
		this.prevModelPos = new THREE.Vector3( 3.5, 0, 5 );

		this.container = new THREE.Group();
		this.bodyNode = null;
		this.wheels = [];
		this.wheelFL = null;
		this.wheelFR = null;
		this.wheelBL = null;
		this.wheelBR = null;

		this.inputX = 0;
		this.inputZ = 0;

		this.driftIntensity = 0;

		// ── Nitro system ────────────────────────────────────────
		this.nitroGauge = 0;          // 0..1, current charge level
		this.nitroActive = false;     // true while boost is firing
		this._nitroPassiveRate = 0.04;  // gauge per second (passive recharge)
		this._nitroDriftRate = 0.15;    // additional gauge per second while drifting
		this._nitroDrainRate = 0.35;    // gauge per second while using nitro
		this._nitroBoostMult = 1.6;     // engine force multiplier during nitro

		// Post-collision reconciliation cooldown (frames to skip soft correction after a contact)
		this._postContactFrames = 0;

		// Arcade vehicle physics
		this._useArcade = USE_ARCADE_VEHICLE;
		this._arcadeVehicle = null;
		this._rayFilter = null;
		this._wheelData = null;

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

		if ( this._useArcade ) {

			this._arcadeVehicle = new ArcadeVehicle( this._stats );

		}

	}

	init( model, stats ) {

		if ( stats ) {

			this._stats = stats;
			if ( this._useArcade ) {

				this._arcadeVehicle = new ArcadeVehicle( this._stats );

			}

		}

		const vehicleModel = model.clone();

		this.container.add( vehicleModel );

		this._frontLightNodes = [];
		this._rearLightNodes  = [];

		// Find body, wheel and headlight nodes
		vehicleModel.traverse( ( child ) => {

			const name = child.name.toLowerCase();

			if ( name === 'body' ) {

				child.rotation.order = 'YXZ';
				this.bodyNode = child;

			} else if ( name.includes( 'wheel' ) ) {

				child.rotation.order = 'YXZ';
				this.wheels.push( child );

				if ( name.includes( 'front' ) && name.includes( 'left' ) ) this.wheelFL = child;
				if ( name.includes( 'front' ) && name.includes( 'right' ) ) this.wheelFR = child;
				if ( name.includes( 'back' ) && name.includes( 'left' ) ) this.wheelBL = child;
				if ( name.includes( 'back' ) && name.includes( 'right' ) ) this.wheelBR = child;

			} else if ( name.includes( 'headlight' ) ) {

				if ( name.includes( 'rear' ) ) {

					this._rearLightNodes.push( child );

				} else {

					this._frontLightNodes.push( child );

				}

			}

			if ( child.isMesh ) {

				child.castShadow = true;
				child.receiveShadow = true;

			}

		} );

		return this.container;

	}

	/**
	 * Apply a cosmetic loadout to this vehicle.
	 * Call after init(). Can be called again to swap cosmetics at runtime.
	 * @param {Object} loadout — { [slotId]: itemId | null }
	 */
	async applyLoadout( loadout ) {

		if ( loadout ) await applyCosmetics( this.container, loadout );

	}

	/** Strip all cosmetics back to stock appearance. */
	stripCosmetics() {

		stripCosmetics( this.container );

	}

	update( dt, controlsInput ) {

		if ( this._useArcade ) {

			this._updateArcade( dt, controlsInput );

		} else {

			this._updateLegacy( dt, controlsInput );

		}

	}

	// ── New arcade vehicle update ────────────────────────────────

	_updateArcade( dt, controlsInput ) {

		this.inputX = controlsInput.x;
		this.inputZ = controlsInput.z;

		// Process input into steer / throttle / brake / handbrake
		let steer = 0, throttle = 0, brake = 0;
		const handbrake = !! controlsInput.handbrake;

		if ( controlsInput.touchActive && ( this.inputX !== 0 || this.inputZ !== 0 ) ) {

			// Touch: joystick defines world-space direction, auto-gas
			// Use chassis quaternion from physics body (not container)
			const pos = this.rigidBody ? this.rigidBody.position : null;
			const q = this.rigidBody ? this.rigidBody.quaternion : null;
			if ( q ) {

				_forward.set( 0, 0, 1 );
				_quat.set( q[ 0 ], q[ 1 ], q[ 2 ], q[ 3 ] );
				_forward.applyQuaternion( _quat );
				const cross = _forward.x * this.inputZ - _forward.z * this.inputX;
				steer = - cross * 2;

			}

			throttle = 1.0;

		} else {

			steer = this.inputX;
			throttle = Math.max( 0, this.inputZ );
			brake = Math.max( 0, - this.inputZ );

		}

		if ( ! this.rigidBody || ! this.physicsWorld ) return;

		// Read chassis state into pre-allocated object
		const pos = this.rigidBody.position;
		const quat = this.rigidBody.quaternion;
		const linVel = this.rigidBody.motionProperties.linearVelocity;
		const angVel = this.rigidBody.motionProperties.angularVelocity;

		const cs = this._chassisState;
		cs.position[ 0 ] = pos[ 0 ]; cs.position[ 1 ] = pos[ 1 ]; cs.position[ 2 ] = pos[ 2 ];
		cs.quaternion[ 0 ] = quat[ 0 ]; cs.quaternion[ 1 ] = quat[ 1 ]; cs.quaternion[ 2 ] = quat[ 2 ]; cs.quaternion[ 3 ] = quat[ 3 ];
		cs.linearVelocity[ 0 ] = linVel[ 0 ]; cs.linearVelocity[ 1 ] = linVel[ 1 ]; cs.linearVelocity[ 2 ] = linVel[ 2 ];
		cs.angularVelocity[ 0 ] = angVel[ 0 ]; cs.angularVelocity[ 1 ] = angVel[ 1 ]; cs.angularVelocity[ 2 ] = angVel[ 2 ];

		// Perform 4 wheel raycasts (pre-allocated buffers)
		const cfg = this._stats;
		const rayLength = cfg.suspensionRestLength + cfg.wheelRadius + 0.25;
		const offsets = this._arcadeVehicle.wheelOffsets;
		const origin = this._rayOrigin;

		_quat.set( quat[ 0 ], quat[ 1 ], quat[ 2 ], quat[ 3 ] );

		for ( let i = 0; i < 4; i ++ ) {

			_tmpVec.set( offsets[ i ][ 0 ], offsets[ i ][ 1 ], offsets[ i ][ 2 ] );
			_tmpVec.applyQuaternion( _quat );
			origin[ 0 ] = pos[ 0 ] + _tmpVec.x;
			origin[ 1 ] = pos[ 1 ] + _tmpVec.y;
			origin[ 2 ] = pos[ 2 ] + _tmpVec.z;

			if ( this._rayFilter ) {

				const hit = castWheelRay( this.physicsWorld, origin, rayLength, this._rayFilter );
				this._rayResults[ i ].hit = hit.hit;
				this._rayResults[ i ].fraction = hit.fraction;

			} else {

				this._rayResults[ i ].hit = false;
				this._rayResults[ i ].fraction = 1.0;

			}

		}

		// ── Nitro charge / drain ────────────────────────────
		// Require a minimum gauge to activate; once active, drain first then check
		if ( !! controlsInput.nitro && this.nitroGauge > 0.01 ) {

			this.nitroGauge = Math.max( 0, this.nitroGauge - this._nitroDrainRate * dt );
			this.nitroActive = this.nitroGauge > 0;

		} else {

			this.nitroActive = false;
			// Passive recharge + drift bonus
			let chargeRate = this._nitroPassiveRate;
			if ( this._arcadeVehicle.drifting ) chargeRate += this._nitroDriftRate;
			this.nitroGauge = Math.min( 1, this.nitroGauge + chargeRate * dt );

		}

		const nitroMult = this.nitroActive ? this._nitroBoostMult : 1;

		// Run arcade vehicle physics
		const result = this._arcadeVehicle.update( dt, cs, { steer, throttle, brake, handbrake, nitroMult }, this._rayResults );

		// Apply forces to chassis body
		for ( let i = 0; i < result.forceCount; i ++ ) {

			const f = result.forces[ i ];
			rigidBody.addForceAtPosition( this.physicsWorld, this.rigidBody, f.force, f.position, true );

		}

		for ( let i = 0; i < result.torqueCount; i ++ ) {

			rigidBody.addTorque( this.physicsWorld, this.rigidBody, result.torques[ i ], true );

		}

		// Update state for visuals and compatibility
		this.linearSpeed = result.linearSpeed;
		this.driftIntensity = result.driftIntensity;
		this._wheelData = result.wheelData;

		this.spherePos.set( pos[ 0 ], pos[ 1 ], pos[ 2 ] );
		this.sphereVel.set( linVel[ 0 ], linVel[ 1 ], linVel[ 2 ] );

		this.acceleration = THREE.MathUtils.lerp(
			this.acceleration,
			this.linearSpeed + ( 0.25 * this.linearSpeed * Math.abs( this.linearSpeed ) ),
			dt
		);

		// Fall reset
		if ( pos[ 1 ] < - 10 ) {

			rigidBody.setPosition( this.physicsWorld, this.rigidBody, [ 3.5, 0.5, 5 ], false );
			rigidBody.setLinearVelocity( this.physicsWorld, this.rigidBody, [ 0, 0, 0 ] );
			rigidBody.setAngularVelocity( this.physicsWorld, this.rigidBody, [ 0, 0, 0 ] );
			rigidBody.setQuaternion( this.physicsWorld, this.rigidBody, [ 0, 0, 0, 1 ], false );
			this.spherePos.set( 3.5, 0.5, 5 );
			this.sphereVel.set( 0, 0, 0 );
			this.linearSpeed = 0;
			this.angularSpeed = 0;
			this.acceleration = 0;
			this._arcadeVehicle.reset();

		}

		// Position container from chassis
		this.container.position.set( pos[ 0 ], pos[ 1 ], pos[ 2 ] );
		this.container.quaternion.set( quat[ 0 ], quat[ 1 ], quat[ 2 ], quat[ 3 ] );

		if ( dt > 0 ) {

			this.modelVelocity.subVectors( this.container.position, this.prevModelPos ).divideScalar( dt );
			this.prevModelPos.copy( this.container.position );

		}

		this._updateBodyArcade( dt );
		this._updateWheelsArcade( dt );

	}

	_updateBodyArcade( dt ) {

		if ( ! this.bodyNode || ! this._wheelData ) return;

		// Pitch from front-vs-rear suspension difference
		const wd = this._wheelData;
		const frontAvg = ( wd[ 0 ].compression + wd[ 1 ].compression ) / 2;
		const rearAvg = ( wd[ 2 ].compression + wd[ 3 ].compression ) / 2;
		const targetPitch = ( frontAvg - rearAvg ) * 2;

		// Roll from left-vs-right suspension difference
		const leftAvg = ( wd[ 0 ].compression + wd[ 2 ].compression ) / 2;
		const rightAvg = ( wd[ 1 ].compression + wd[ 3 ].compression ) / 2;
		const targetRoll = ( leftAvg - rightAvg ) * 2;

		this.bodyNode.rotation.x = lerpAngle( this.bodyNode.rotation.x, targetPitch, dt * 8 );
		this.bodyNode.rotation.z = lerpAngle( this.bodyNode.rotation.z, targetRoll, dt * 8 );
		this.bodyNode.position.y = THREE.MathUtils.lerp( this.bodyNode.position.y, 0.2, dt * 5 );

	}

	_updateWheelsArcade( dt ) {

		if ( ! this._wheelData ) return;

		const wd = this._wheelData;

		// Spin all wheels based on ground speed
		for ( let i = 0; i < this.wheels.length; i ++ ) {

			const wheel = this.wheels[ i ];
			if ( ! wheel ) continue;

			// Map to wheelData index
			let wIdx = - 1;
			if ( wheel === this.wheelFL ) wIdx = 0;
			else if ( wheel === this.wheelFR ) wIdx = 1;
			else if ( wheel === this.wheelBL ) wIdx = 2;
			else if ( wheel === this.wheelBR ) wIdx = 3;

			if ( wIdx >= 0 ) {

				wheel.rotation.x = wd[ wIdx ].spin;

				// Suspension visual: offset wheel Y by compression
				// (negative Y = wheel moves up into chassis)
				const restY = 0; // wheels are at their model rest position
				wheel.position.y = restY - wd[ wIdx ].compression * 0.5;

			}

		}

		// Front wheels steering
		if ( this.wheelFL ) {

			this.wheelFL.rotation.y = lerpAngle( this.wheelFL.rotation.y, - this._arcadeVehicle.currentSteerAngle, dt * 10 );

		}

		if ( this.wheelFR ) {

			this.wheelFR.rotation.y = lerpAngle( this.wheelFR.rotation.y, - this._arcadeVehicle.currentSteerAngle, dt * 10 );

		}

	}

	// ── Legacy sphere-based update ───────────────────────────────

	_updateLegacy( dt, controlsInput ) {

		this.inputX = controlsInput.x;
		this.inputZ = controlsInput.z;

		if ( controlsInput.touchActive && ( this.inputX !== 0 || this.inputZ !== 0 ) ) {

			// Touch: joystick defines world-space direction, auto-gas
			const targetAngle = Math.atan2( this.inputX, this.inputZ );
			_quat.setFromAxisAngle( _up, targetAngle );
			this.container.quaternion.slerp( _quat, 1 - Math.exp( - 3 * dt ) );

			_forward.set( 0, 0, 1 ).applyQuaternion( this.container.quaternion );
			const cross = _forward.x * this.inputZ - _forward.z * this.inputX;
			this.inputX = - cross * 2;

			this.linearSpeed = THREE.MathUtils.lerp( this.linearSpeed, this._stats.maxSpeed, dt * this._stats.accelRate );

		} else {

			// Keyboard / gamepad: standard steering + throttle
			let direction = Math.sign( this.linearSpeed );
			if ( direction === 0 ) direction = Math.abs( this.inputZ ) > 0.1 ? Math.sign( this.inputZ ) : 1;

			const steeringGrip = THREE.MathUtils.clamp( Math.abs( this.linearSpeed ), 0.2, 1.0 );

			const targetAngular = - this.inputX * steeringGrip * this._stats.steeringMult * direction;
			this.angularSpeed = THREE.MathUtils.lerp( this.angularSpeed, targetAngular, dt * 4 );

			this.container.rotateY( this.angularSpeed * dt );

			const targetSpeed = this.inputZ * this._stats.maxSpeed;

			if ( targetSpeed < 0 && this.linearSpeed > 0.01 ) {

				this.linearSpeed = THREE.MathUtils.lerp( this.linearSpeed, 0.0, dt * 8 );

			} else if ( targetSpeed < 0 ) {

				this.linearSpeed = THREE.MathUtils.lerp( this.linearSpeed, targetSpeed / 2, dt * 2 );

			} else {

				this.linearSpeed = THREE.MathUtils.lerp( this.linearSpeed, targetSpeed, dt * this._stats.accelRate );

			}

		}

		_tmpVec.set( 0, 1, 0 ).applyQuaternion( this.container.quaternion );

		if ( _tmpVec.y > 0.5 ) {

			const targetQuat = this.alignWithY( this.container.quaternion, _up );
			this.container.quaternion.slerp( targetQuat, 0.2 );

		}

		if ( ! this.physicsWorld || ! this.physicsWorld._isServerWorld ) {

			this.linearSpeed *= Math.max( 0, 1 - LINEAR_DAMP * dt );

		}

		if ( this.rigidBody ) {

			_forward.set( 0, 0, 1 ).applyQuaternion( this.container.quaternion );
			_forward.y = 0;
			_forward.normalize();

			_right.set( 1, 0, 0 ).applyQuaternion( this.container.quaternion );
			_right.y = 0;
			_right.normalize();

			const angvel = this.rigidBody.motionProperties.angularVelocity;
			const drive = this.linearSpeed * this._stats.driveMult * dt;

			rigidBody.setAngularVelocity( this.physicsWorld, this.rigidBody, [
				angvel[ 0 ] + _right.x * drive,
				angvel[ 1 ],
				angvel[ 2 ] + _right.z * drive
			] );

			const pos = this.rigidBody.position;
			this.spherePos.set( pos[ 0 ], pos[ 1 ], pos[ 2 ] );

			const vel = this.rigidBody.motionProperties.linearVelocity;
			this.sphereVel.set( vel[ 0 ], vel[ 1 ], vel[ 2 ] );

		}

		this.acceleration = THREE.MathUtils.lerp(
			this.acceleration,
			this.linearSpeed + ( 0.25 * this.linearSpeed * Math.abs( this.linearSpeed ) ),
			dt
		);

		if ( this.spherePos.y < - 10 ) {

			if ( this.rigidBody ) {

				rigidBody.setPosition( this.physicsWorld, this.rigidBody, [ 3.5, 0.5, 5 ], false );
				rigidBody.setLinearVelocity( this.physicsWorld, this.rigidBody, [ 0, 0, 0 ] );
				rigidBody.setAngularVelocity( this.physicsWorld, this.rigidBody, [ 0, 0, 0 ] );

			}

			this.spherePos.set( 3.5, 0.5, 5 );
			this.sphereVel.set( 0, 0, 0 );
			this.linearSpeed = 0;
			this.angularSpeed = 0;
			this.acceleration = 0;
			this.container.rotation.set( 0, 0, 0 );
			this.container.quaternion.identity();

		}

		this.container.position.set(
			this.spherePos.x,
			this.spherePos.y - 0.5,
			this.spherePos.z
		);

		if ( dt > 0 ) {

			this.modelVelocity.subVectors( this.container.position, this.prevModelPos ).divideScalar( dt );
			this.prevModelPos.copy( this.container.position );

		}

		this.updateBody( dt );
		this.updateWheels( dt );

		this.driftIntensity = Math.abs( this.linearSpeed - this.acceleration ) +
			( this.bodyNode ? Math.abs( this.bodyNode.rotation.z ) * 2 : 0 );

	}

	alignWithY( quaternion, newY ) {

		_zAxis.set( 0, 0, 1 ).applyQuaternion( quaternion );
		const xAxis = _tmpVec.crossVectors( _zAxis, newY ).negate().normalize();
		_newZ.crossVectors( xAxis, newY ).normalize();

		_mat4.makeBasis( xAxis, newY, _newZ );
		return _quat.setFromRotationMatrix( _mat4 );

	}

	updateBody( dt ) {

		if ( ! this.bodyNode ) return;

		this.bodyNode.rotation.x = lerpAngle(
			this.bodyNode.rotation.x,
			-( this.linearSpeed - this.acceleration ) / 6,
			dt * 10
		);

		this.bodyNode.rotation.z = lerpAngle(
			this.bodyNode.rotation.z,
			-( this.inputX / 5 ) * this.linearSpeed,
			dt * 5
		);

		this.bodyNode.position.y = THREE.MathUtils.lerp( this.bodyNode.position.y, 0.2, dt * 5 );

	}

	updateWheels( dt ) {

		for ( const wheel of this.wheels ) {

			wheel.rotation.x += this.acceleration;

		}

		if ( this.wheelFL ) {

			this.wheelFL.rotation.y = lerpAngle( this.wheelFL.rotation.y, -this.inputX / 1.5, dt * 10 );

		}

		if ( this.wheelFR ) {

			this.wheelFR.rotation.y = lerpAngle( this.wheelFR.rotation.y, -this.inputX / 1.5, dt * 10 );

		}

	}

	// Multiplayer frozen state: apply server position directly (countdown/finished)
	updateFromServer( dt, serverState ) {

		if ( ! serverState ) return;

		const yOffset = this._useArcade ? 0 : - 0.5;

		this.spherePos.set( serverState.sx, serverState.sy, serverState.sz );
		this.container.position.set( serverState.sx, serverState.sy + yOffset, serverState.sz );
		this.container.quaternion.set( serverState.sqx, serverState.sqy, serverState.sqz, serverState.sqw );


		this.linearSpeed = serverState.linearSpeed;
		this.acceleration = serverState.acceleration;
		this.driftIntensity = serverState.driftIntensity;
		this.inputX = serverState.inputX;
		this.inputZ = serverState.inputZ;

		if ( dt > 0 ) {

			this.modelVelocity.subVectors( this.container.position, this.prevModelPos ).divideScalar( dt );
			this.prevModelPos.copy( this.container.position );

		}

		if ( this._useArcade ) {

			this._updateBodyArcade( dt );
			this._updateWheelsArcade( dt );

		} else {

			this.updateBody( dt );
			this.updateWheels( dt );

		}

	}

	// Soft reconciliation: nudge local prediction toward server authority
	reconcileFromServer( serverState ) {

		if ( ! serverState || ! this.rigidBody || ! this.physicsWorld ) return;

		// Decrement post-contact cooldown each frame
		if ( this._postContactFrames > 0 ) this._postContactFrames--;

		const SNAP_THRESHOLD = 8.0;

		const sx = serverState.sx;
		const sy = serverState.sy;
		const sz = serverState.sz;

		// Always read current position from the physics body (authoritative after this frame's update)
		const curPos = this.rigidBody.position;
		const dx = sx - curPos[ 0 ];
		const dy = sy - curPos[ 1 ];
		const dz = sz - curPos[ 2 ];
		const error = Math.sqrt( dx * dx + dy * dy + dz * dz );

		if ( error > SNAP_THRESHOLD ) {

			// Hard snap: teleport to server position, keep server orientation
			rigidBody.setPosition( this.physicsWorld, this.rigidBody, [ sx, sy, sz ], false );
			this.spherePos.set( sx, sy, sz );

			if ( this._useArcade ) {

				rigidBody.setQuaternion( this.physicsWorld, this.rigidBody,
					[ serverState.sqx, serverState.sqy, serverState.sqz, serverState.sqw ], false );

			}

			this._postContactFrames = 0;

		} else if ( error > 0.05 ) {

			// During post-contact frames: apply a much gentler correction so physics can settle
			// without blocking it entirely (which caused divergence to build up → saccade on resume).
			const inContact = this._postContactFrames > 0;
			const rate = inContact
				? Math.min( 0.02, error * 0.03 )   // very gentle during contact
				: Math.min( 0.1, error * 0.2 );     // normal soft correction otherwise

			const cx = curPos[ 0 ] + dx * rate;
			const cy = curPos[ 1 ] + dy * rate;
			const cz = curPos[ 2 ] + dz * rate;
			rigidBody.setPosition( this.physicsWorld, this.rigidBody, [ cx, cy, cz ], false );

		}

		// Rotation correction — reduced during contact to avoid physics-induced flips
		if ( this._useArcade ) {

			if ( error < 2.0 ) {

				const inContact = this._postContactFrames > 0;
				const rotRate = inContact ? 0.01 : 0.03;
				const bq = this.rigidBody.quaternion;
				_currQ.set( bq[ 0 ], bq[ 1 ], bq[ 2 ], bq[ 3 ] );
				_quat.set( serverState.sqx, serverState.sqy, serverState.sqz, serverState.sqw );
				_currQ.slerp( _quat, rotRate );
				rigidBody.setQuaternion( this.physicsWorld, this.rigidBody,
					[ _currQ.x, _currQ.y, _currQ.z, _currQ.w ], false );

			}

		} else {

			_currQ.set( serverState.sqx, serverState.sqy, serverState.sqz, serverState.sqw );
			this.container.quaternion.slerp( _currQ, 0.1 );

		}

		// Nudge speed toward server — faster rate so divergence after a wall hit resolves quickly
		this.linearSpeed = this.linearSpeed + ( serverState.linearSpeed - this.linearSpeed ) * 0.15;

	}

	set weatherType( type ) {

		if ( this._arcadeVehicle ) this._arcadeVehicle.weatherType = type;

	}

	/**
	 * Attach lights to GLB headlight nodes (front + rear), falling back to
	 * hardcoded positions if the model has no headlight_* nodes yet.
	 * Call once after init(). All lights are off by default.
	 */
	addHeadlights() {

		this._frontSpots = [];
		this._rearLights = [];

		// Materials for front (white) and rear (red) bulb nodes
		this._frontMatOff = new THREE.MeshBasicMaterial( { color: 0x2a2e33 } );
		this._frontMatOn  = new THREE.MeshBasicMaterial( { color: 0xfff5cc } );
		this._rearMatOff  = new THREE.MeshBasicMaterial( { color: 0x2a0000 } );
		this._rearMatOn   = new THREE.MeshBasicMaterial( { color: 0xff2200 } );

		// ── Front headlights (SpotLight, white, aimed forward + down) ──
		const frontNodes = this._frontLightNodes.length > 0
			? this._frontLightNodes
			: _makeFallbackNodes( _FALLBACK_FRONT, this.container );

		for ( const node of frontNodes ) {

			const spot = new THREE.SpotLight( 0xfff5e0, 0, 18, Math.PI / 7, 0.4, 1.5 );
			const target = new THREE.Object3D();
			target.position.set( 0, -0.6, 8 );
			node.add( target );
			spot.target = target;
			node.add( spot );
			this._frontSpots.push( spot );

			if ( node.isMesh ) node.material = this._frontMatOff;

		}

		// ── Rear lights (PointLight, red, low intensity) ──
		const rearNodes = this._rearLightNodes.length > 0
			? this._rearLightNodes
			: _makeFallbackNodes( _FALLBACK_REAR, this.container );

		for ( const node of rearNodes ) {

			const pt = new THREE.PointLight( 0xff1500, 0, 3, 2 );
			node.add( pt );
			this._rearLights.push( pt );

			if ( node.isMesh ) node.material = this._rearMatOff;

		}

		this._headlightsOn = false;
		this._rearIntensity = 0; // current smoothed intensity

	}

	/** Turn all vehicle lights on or off. */
	setHeadlights( on ) {

		if ( ! this._frontSpots ) return;
		this._headlightsOn = on;

		for ( const spot of this._frontSpots ) spot.intensity = on ? 18 : 0;

		// Rear lights: snap to position intensity (or off), brake smoothing handles the rest
		if ( ! on ) {

			this._rearIntensity = 0;
			for ( const pt of this._rearLights ) pt.intensity = 0;
			for ( const node of this._rearLightNodes ) {

				if ( node.isMesh ) node.material = this._rearMatOff;

			}

		}

		for ( const node of this._frontLightNodes ) {

			if ( node.isMesh ) node.material = on ? this._frontMatOn : this._frontMatOff;

		}

	}

	/**
	 * Smoothly update rear light intensity based on braking input.
	 * Call every frame from the game loop (only when headlights are on).
	 * @param {number} dt
	 * @param {{ z: number, handbrake: boolean }} input
	 */
	updateBrakeLights( dt, input ) {

		if ( ! this._rearLights || ! this._headlightsOn ) return;

		const braking = input.z < -0.05 || input.handbrake;
		const target  = braking ? 4.0 : 0.8;
		this._rearIntensity += ( target - this._rearIntensity ) * ( 1 - Math.exp( -dt * 12 ) );

		for ( const pt of this._rearLights ) pt.intensity = this._rearIntensity;

		const bright = this._rearIntensity > 2.0;
		for ( const node of this._rearLightNodes ) {

			if ( node.isMesh ) node.material = bright ? this._rearMatOn : this._rearMatOff;

		}

	}

	get headlightsOn() { return !! this._headlightsOn; }

}
