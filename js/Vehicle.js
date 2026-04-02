import * as THREE from 'three';
import { rigidBody } from 'crashcat';
import { ArcadeVehicle } from '../shared/ArcadeVehicle.js';
import { castWheelRay } from './Physics.js';
import { applyCosmetics, stripCosmetics } from './CosmeticApplicator.js';

const _tmpVec = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _currQ = new THREE.Quaternion();
const _up = new THREE.Vector3( 0, 1, 0 );

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

		// In multiplayer the server is authoritative for fall resets — skip client-side reset
		this.isMultiplayer = false;

		// Spawn state for fall resets — set externally after construction from track spawn data
		this._spawnPos = null;
		this._spawnAngle = 0;

		// Arcade vehicle physics
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

		this._arcadeVehicle = new ArcadeVehicle( this._stats );

	}

	init( model, stats ) {

		if ( stats ) {

			this._stats = stats;
			this._arcadeVehicle = new ArcadeVehicle( this._stats );

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

		this._updateArcade( dt, controlsInput );

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

		// Guard: if the physics body's quaternion is NaN (solver edge-case),
		// reset it to identity and skip this frame to prevent NaN propagation
		// through ALL force calculations (forward/right/up → grip/suspension/steering).
		if ( ! isFinite( quat[ 0 ] ) || ! isFinite( quat[ 1 ] ) || ! isFinite( quat[ 2 ] ) || ! isFinite( quat[ 3 ] ) ) {

			rigidBody.setQuaternion( this.physicsWorld, this.rigidBody, [ 0, 0, 0, 1 ], false );
			rigidBody.setLinearVelocity( this.physicsWorld, this.rigidBody, [ 0, 0, 0 ] );
			rigidBody.setAngularVelocity( this.physicsWorld, this.rigidBody, [ 0, 0, 0 ] );
			this._arcadeVehicle.reset();
			return;

		}

		// Same guard for position/velocity — a NaN anywhere corrupts all downstream math
		if ( ! isFinite( pos[ 0 ] ) || ! isFinite( pos[ 1 ] ) || ! isFinite( pos[ 2 ] )
			|| ! isFinite( linVel[ 0 ] ) || ! isFinite( linVel[ 1 ] ) || ! isFinite( linVel[ 2 ] ) ) {

			const rp = this._spawnPos || [ 3.5, 0.5, 5 ];
			rigidBody.setPosition( this.physicsWorld, this.rigidBody, rp, false );
			rigidBody.setQuaternion( this.physicsWorld, this.rigidBody, [ 0, 0, 0, 1 ], false );
			rigidBody.setLinearVelocity( this.physicsWorld, this.rigidBody, [ 0, 0, 0 ] );
			rigidBody.setAngularVelocity( this.physicsWorld, this.rigidBody, [ 0, 0, 0 ] );
			this._arcadeVehicle.reset();
			return;

		}

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

		// Fall reset — in multiplayer the server handles this authoritatively,
		// client will snap via reconciliation (avoids dual-reset desync).
		if ( pos[ 1 ] < - 10 && ! this.isMultiplayer ) {

			const rp = this._spawnPos || [ 3.5, 0.5, 5 ];
			const a = this._spawnAngle || 0;
			const rq = [ 0, Math.sin( a / 2 ), 0, Math.cos( a / 2 ) ];

			rigidBody.setPosition( this.physicsWorld, this.rigidBody, rp, false );
			rigidBody.setLinearVelocity( this.physicsWorld, this.rigidBody, [ 0, 0, 0 ] );
			rigidBody.setAngularVelocity( this.physicsWorld, this.rigidBody, [ 0, 0, 0 ] );
			rigidBody.setQuaternion( this.physicsWorld, this.rigidBody, rq, false );
			this.spherePos.set( rp[ 0 ], rp[ 1 ], rp[ 2 ] );
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

	// Multiplayer frozen state: apply server position directly (countdown/finished)
	updateFromServer( dt, serverState ) {

		if ( ! serverState ) return;

		this.spherePos.set( serverState.sx, serverState.sy, serverState.sz );
		this.container.position.set( serverState.sx, serverState.sy, serverState.sz );
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

		this._updateBodyArcade( dt );
		this._updateWheelsArcade( dt );

	}

	// Server reconciliation — minimal approach.
	// The client runs the same physics as the server (shared ArcadeVehicle),
	// so prediction is naturally very close. We only intervene for hard snaps
	// (fall resets, teleports) and let the physics run freely otherwise.
	// This keeps the multiplayer feel identical to offline.
	reconcileFromServer( serverState, inputBuffer ) {

		if ( ! serverState || ! this.rigidBody || ! this.physicsWorld ) return;

		if ( inputBuffer && serverState.lastInputSeq ) {

			inputBuffer.discardUpTo( serverState.lastInputSeq );

		}

		const curPos = this.rigidBody.position;
		const dx = serverState.sx - curPos[ 0 ];
		const dy = serverState.sy - curPos[ 1 ];
		const dz = serverState.sz - curPos[ 2 ];
		const error = Math.sqrt( dx * dx + dy * dy + dz * dz );

		// Hard snap only for teleport-level desyncs (fall reset, respawn)
		if ( error > 8.0 ) {

			const svx = serverState.svx || 0;
			const svy = serverState.svy || 0;
			const svz = serverState.svz || 0;

			rigidBody.setPosition( this.physicsWorld, this.rigidBody,
				[ serverState.sx, serverState.sy, serverState.sz ], false );
			rigidBody.setLinearVelocity( this.physicsWorld, this.rigidBody, [ svx, svy, svz ] );
			rigidBody.setAngularVelocity( this.physicsWorld, this.rigidBody,
				[ serverState.savx || 0, serverState.savy || 0, serverState.savz || 0 ] );
			rigidBody.setQuaternion( this.physicsWorld, this.rigidBody,
				[ serverState.sqx, serverState.sqy, serverState.sqz, serverState.sqw ], false );
			if ( this._arcadeVehicle ) this._arcadeVehicle.reset();
			if ( inputBuffer ) inputBuffer.clear();
			this.linearSpeed = serverState.linearSpeed;
			return;

		}

		this.linearSpeed += ( serverState.linearSpeed - this.linearSpeed ) * 0.15;

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
