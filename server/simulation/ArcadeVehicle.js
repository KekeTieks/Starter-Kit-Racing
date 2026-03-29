// ArcadeVehicle.js — Pure math arcade vehicle physics module
// No Three.js or crashcat dependency — shared between client and server

const EPSILON = 0.001;

// ── Weather physics multipliers ──────────────────────────────────────
// Keep in sync with js/ArcadeVehicle.js

export const WEATHER_PHYSICS = {
	clear: { gripMultiplier: 1.0,  dragMultiplier: 1.0 },
	rain:  { gripMultiplier: 0.7,  dragMultiplier: 1.3 },
	fog:   { gripMultiplier: 1.0,  dragMultiplier: 1.0 },
	storm: { gripMultiplier: 0.55, dragMultiplier: 1.5 },
};

// ── vec3 helpers (zero-allocation) ──────────────────────────────────

function v3Set( out, x, y, z ) { out[ 0 ] = x; out[ 1 ] = y; out[ 2 ] = z; return out; }
function v3Copy( out, a ) { out[ 0 ] = a[ 0 ]; out[ 1 ] = a[ 1 ]; out[ 2 ] = a[ 2 ]; return out; }

function v3Add( out, a, b ) {
	out[ 0 ] = a[ 0 ] + b[ 0 ]; out[ 1 ] = a[ 1 ] + b[ 1 ]; out[ 2 ] = a[ 2 ] + b[ 2 ]; return out;
}

function v3Scale( out, a, s ) {
	out[ 0 ] = a[ 0 ] * s; out[ 1 ] = a[ 1 ] * s; out[ 2 ] = a[ 2 ] * s; return out;
}

function v3AddScaled( out, a, b, s ) {
	out[ 0 ] = a[ 0 ] + b[ 0 ] * s; out[ 1 ] = a[ 1 ] + b[ 1 ] * s; out[ 2 ] = a[ 2 ] + b[ 2 ] * s; return out;
}

function v3Dot( a, b ) { return a[ 0 ] * b[ 0 ] + a[ 1 ] * b[ 1 ] + a[ 2 ] * b[ 2 ]; }

function v3Cross( out, a, b ) {
	out[ 0 ] = a[ 1 ] * b[ 2 ] - a[ 2 ] * b[ 1 ];
	out[ 1 ] = a[ 2 ] * b[ 0 ] - a[ 0 ] * b[ 2 ];
	out[ 2 ] = a[ 0 ] * b[ 1 ] - a[ 1 ] * b[ 0 ];
	return out;
}

function v3Len( a ) { return Math.sqrt( a[ 0 ] * a[ 0 ] + a[ 1 ] * a[ 1 ] + a[ 2 ] * a[ 2 ] ); }

function v3Normalize( out, a ) {
	const l = v3Len( a ) || 1;
	out[ 0 ] = a[ 0 ] / l; out[ 1 ] = a[ 1 ] / l; out[ 2 ] = a[ 2 ] / l; return out;
}

function v3ApplyQuat( out, v, q ) {
	const qx = q[ 0 ], qy = q[ 1 ], qz = q[ 2 ], qw = q[ 3 ];
	const vx = v[ 0 ], vy = v[ 1 ], vz = v[ 2 ];
	const tx = 2 * ( qy * vz - qz * vy ), ty = 2 * ( qz * vx - qx * vz ), tz = 2 * ( qx * vy - qy * vx );
	out[ 0 ] = vx + qw * tx + ( qy * tz - qz * ty );
	out[ 1 ] = vy + qw * ty + ( qz * tx - qx * tz );
	out[ 2 ] = vz + qw * tz + ( qx * ty - qy * tx );
	return out;
}

function clamp( v, min, max ) { return v < min ? min : v > max ? max : v; }
function lerp( a, b, t ) { return a + ( b - a ) * t; }

// ── Wheel indices ───────────────────────────────────────────────────

const FL = 0, FR = 1, BL = 2, BR = 3;
const MAX_FORCES = 16;
const MAX_TORQUES = 8;

// ── ArcadeVehicle class ─────────────────────────────────────────────

export class ArcadeVehicle {

	constructor( config ) {

		this.cfg = config;

		const hw = config.trackWidth / 2;
		const hb = config.wheelBase / 2;
		this.wheelOffsets = [
			[ - hw, 0, hb ],   // FL
			[ hw, 0, hb ],     // FR
			[ - hw, 0, - hb ], // BL
			[ hw, 0, - hb ],   // BR
		];

		this.prevCompression = [ 0, 0, 0, 0 ];
		this.wheelSpin = [ 0, 0, 0, 0 ];
		this.currentSteerAngle = 0;

		this.drifting = false;
		this.currentRearGrip = config.gripRear;
		this.driftIntensity = 0;
		this.weatherType = 'clear';

		// Pre-allocated output buffers (no GC per frame)
		this._forces = [];
		this._torques = [];
		for ( let i = 0; i < MAX_FORCES; i ++ ) this._forces.push( { force: [ 0, 0, 0 ], position: [ 0, 0, 0 ] } );
		for ( let i = 0; i < MAX_TORQUES; i ++ ) this._torques.push( [ 0, 0, 0 ] );
		this._forceCount = 0;
		this._torqueCount = 0;

		// Pre-allocated wheel data output
		this._wheelData = [];
		for ( let i = 0; i < 4; i ++ ) this._wheelData.push( { compression: 0, steerAngle: 0, spin: 0, grounded: false } );

		// Pre-allocated result object
		this._result = {
			forces: null, forceCount: 0,
			torques: null, torqueCount: 0,
			wheelData: this._wheelData,
			driftIntensity: 0, linearSpeed: 0,
		};

		// Scratch
		this._wheelWorldPos = [ [ 0, 0, 0 ], [ 0, 0, 0 ], [ 0, 0, 0 ], [ 0, 0, 0 ] ];
		this._suspForce = [ 0, 0, 0, 0 ];
		this._suspCompression = [ 0, 0, 0, 0 ];
		this._grounded = [ false, false, false, false ];
		this._tmp1 = [ 0, 0, 0 ];
		this._forward = [ 0, 0, 0 ];
		this._right = [ 0, 0, 0 ];
		this._up = [ 0, 0, 0 ];

	}

	_pushForce( fx, fy, fz, px, py, pz ) {

		const i = this._forceCount ++;
		const f = this._forces[ i ];
		f.force[ 0 ] = fx; f.force[ 1 ] = fy; f.force[ 2 ] = fz;
		f.position[ 0 ] = px; f.position[ 1 ] = py; f.position[ 2 ] = pz;

	}

	_pushTorque( tx, ty, tz ) {

		const t = this._torques[ this._torqueCount ++ ];
		t[ 0 ] = tx; t[ 1 ] = ty; t[ 2 ] = tz;

	}

	update( dt, chassis, input, rayResults ) {

		const cfg = this.cfg;
		this._forceCount = 0;
		this._torqueCount = 0;

		// ── Weather multipliers ──────────────────────────────────
		const _wm = WEATHER_PHYSICS[ this.weatherType ] ?? WEATHER_PHYSICS.clear;
		const _effectiveGrip = _wm.gripMultiplier;
		const _effectiveDrag = _wm.dragMultiplier;

		// ── Chassis axes ─────────────────────────────────────────

		v3ApplyQuat( this._forward, [ 0, 0, 1 ], chassis.quaternion );
		v3ApplyQuat( this._right, [ 1, 0, 0 ], chassis.quaternion );
		v3ApplyQuat( this._up, [ 0, 1, 0 ], chassis.quaternion );

		const speed = chassis.linearVelocity[ 0 ] * this._forward[ 0 ]
			+ chassis.linearVelocity[ 2 ] * this._forward[ 2 ];
		const absSpeed = Math.abs( speed );
		const topSpeed = cfg.maxSpeed * 10;
		const speedFraction = clamp( absSpeed / topSpeed, 0, 1 );

		const cx = chassis.position[ 0 ], cy = chassis.position[ 1 ], cz = chassis.position[ 2 ];

		// ── 1. Steering ──────────────────────────────────────────

		// Non-linear input: small dead zone + exponential curve for precision
		const rawSteer = input.steer;
		const steerSign = rawSteer >= 0 ? 1 : - 1;
		const steerAbs = Math.abs( rawSteer );
		// Dead zone (below 0.05 = no steer) + exponential curve (gentle center, sharp edges)
		const shapedSteer = steerAbs < 0.05 ? 0 : steerSign * ( steerAbs * steerAbs );

		// Tighter turns at low speed, more stability at high speed
		const lowSpeedBoost = 1 + ( 1 - speedFraction ) * 0.5;
		const effectiveMaxSteer = cfg.maxSteerAngle * lowSpeedBoost * ( 1 - speedFraction * cfg.speedSteerReduction );
		const targetSteer = shapedSteer * effectiveMaxSteer;
		this.currentSteerAngle = lerp( this.currentSteerAngle, targetSteer, 1 - Math.exp( - cfg.steerSpeed * dt ) );

		// ── 2. Suspension ────────────────────────────────────────

		const rayLength = cfg.suspensionRestLength + cfg.wheelRadius + 0.25;
		let groundedCount = 0;

		for ( let i = 0; i < 4; i ++ ) {

			v3ApplyQuat( this._tmp1, this.wheelOffsets[ i ], chassis.quaternion );
			v3Add( this._wheelWorldPos[ i ], chassis.position, this._tmp1 );

			const ray = rayResults[ i ];

			if ( ray && ray.hit ) {

				const hitDist = ray.fraction * rayLength;
				const compression = cfg.suspensionRestLength - ( hitDist - cfg.wheelRadius );

				if ( compression > 0 ) {

					this._grounded[ i ] = true;
					groundedCount ++;
					this._suspCompression[ i ] = compression;

					const compVel = ( compression - this.prevCompression[ i ] ) / dt;
					const damping = compVel > 0 ? cfg.dampingCompression : cfg.dampingRelaxation;
					let force = cfg.springStiffness * compression + damping * compVel;
					force = Math.max( 0, force );

					this._suspForce[ i ] = force;
					this.prevCompression[ i ] = compression;

					const wp = this._wheelWorldPos[ i ];
					this._pushForce( 0, force, 0, wp[ 0 ], wp[ 1 ], wp[ 2 ] );

				} else {

					this._grounded[ i ] = false;
					this._suspForce[ i ] = 0;
					this._suspCompression[ i ] = 0;
					this.prevCompression[ i ] = 0;

				}

			} else {

				this._grounded[ i ] = false;
				this._suspForce[ i ] = 0;
				this._suspCompression[ i ] = 0;
				this.prevCompression[ i ] = lerp( this.prevCompression[ i ], 0, dt * 5 );

			}

		}

		// ── 3. Driving force ─────────────────────────────────────

		if ( groundedCount > 0 ) {

			const fwd0 = this._forward[ 0 ], fwd2 = this._forward[ 2 ];

			// Engine
			if ( input.throttle > 0 ) {

				const torqueCurve = 1 - speedFraction * 0.7;
				const engineF = input.throttle * cfg.engineForce * torqueCurve;
				this._pushForce( fwd0 * engineF, 0, fwd2 * engineF, cx, cy, cz );

			}

			// Brake / Reverse
			if ( input.brake > 0 ) {

				if ( speed > 0.3 ) {

					const brakeF = input.brake * cfg.brakeForce;
					this._pushForce( - fwd0 * brakeF, 0, - fwd2 * brakeF, cx, cy, cz );

				} else {

					const reverseTopSpeed = topSpeed * 0.4;
					const reverseSpeedFrac = clamp( Math.abs( speed ) / reverseTopSpeed, 0, 1 );
					const reverseCurve = 1 - reverseSpeedFrac * 0.8;
					const revF = input.brake * cfg.engineForce * 0.5 * reverseCurve;
					this._pushForce( - fwd0 * revF, 0, - fwd2 * revF, cx, cy, cz );

				}

			}

			// Handbrake: progressive rear-wheel drag (weaker than full brake, allows sliding)
			if ( input.handbrake && speed > 0.1 ) {

				const hbForce = cfg.brakeForce * 0.45;
				this._pushForce( - fwd0 * hbForce, 0, - fwd2 * hbForce, cx, cy, cz );

			}

			// Engine braking: when no input, gentle deceleration
			if ( input.throttle === 0 && input.brake === 0 && ! input.handbrake && absSpeed > 0.1 ) {

				const engineBrakeF = absSpeed * cfg.mass * 0.8;
				const dir = speed > 0 ? - 1 : 1;
				this._pushForce( fwd0 * dir * engineBrakeF, 0, fwd2 * dir * engineBrakeF, cx, cy, cz );

			}

			// Drag
			const vx = chassis.linearVelocity[ 0 ], vz = chassis.linearVelocity[ 2 ];
			const velXZLen = Math.sqrt( vx * vx + vz * vz );
			if ( velXZLen > EPSILON ) {

				const dragF = velXZLen * velXZLen * cfg.dragCoefficient * _effectiveDrag + cfg.rollingResistance;
				const inv = 1 / velXZLen;
				this._pushForce( - vx * inv * dragF, 0, - vz * inv * dragF, cx, cy, cz );

			}

		}

		// ── 3b. Downforce ────────────────────────────────────────
		// At high speed, push the car down for more grip and stability

		if ( groundedCount > 0 && absSpeed > 1 ) {

			const downforceF = speedFraction * speedFraction * cfg.mass * 5;
			this._pushForce( 0, - downforceF, 0, cx, cy, cz );

		}

		// ── 3c. Weight transfer pitch ────────────────────────────

		if ( groundedCount > 0 ) {

			let pitchTorque = 0;

			if ( input.throttle > 0 ) {

				pitchTorque = - input.throttle * cfg.mass * 1.5 * ( 1 - speedFraction * 0.5 );

			} else if ( input.brake > 0 && speed > 0.3 ) {

				pitchTorque = input.brake * cfg.mass * 2.0;

			}

			if ( Math.abs( pitchTorque ) > EPSILON ) {

				this._pushTorque(
					this._right[ 0 ] * pitchTorque,
					this._right[ 1 ] * pitchTorque,
					this._right[ 2 ] * pitchTorque
				);

			}

		}

		// ── 4. Steering torque ───────────────────────────────────

		if ( groundedCount > 0 && absSpeed > 0.1 ) {

			const steerDir = speed >= 0 ? - 1 : 1;
			// Reverse: slower steering
			const reverseScale = speed >= 0 ? 1 : 0.6;
			const steerTorque = steerDir * this.currentSteerAngle
				* clamp( absSpeed, 0.5, 5 ) * cfg.mass * 5 * reverseScale;
			this._pushTorque( 0, steerTorque, 0 );

			// Yaw damping
			const yawRate = chassis.angularVelocity[ 1 ];
			this._pushTorque( 0, - yawRate * cfg.mass * 3, 0 );

			// ── 4b. Body roll in turns ───────────────────────────
			// Lean outward when turning — proportional to lateral acceleration
			const latAccel = yawRate * absSpeed;
			const rollTorque = latAccel * cfg.mass * 0.3;
			this._pushTorque(
				this._forward[ 0 ] * rollTorque,
				this._forward[ 1 ] * rollTorque,
				this._forward[ 2 ] * rollTorque
			);

		}

		// ── 5. Lateral grip ──────────────────────────────────────

		if ( groundedCount > 0 ) {

			const latSpeed = v3Dot( chassis.linearVelocity, this._right );

			const steerMag = Math.abs( input.steer );
			const handbrake = !! input.handbrake;

			// Handbrake or cornering at speed triggers drift
			const shouldDrift = handbrake || ( absSpeed > cfg.driftThreshold * 2 && steerMag > 0.5 );

			if ( shouldDrift && ! this.drifting ) this.drifting = true;
			else if ( ! shouldDrift && this.drifting && steerMag < 0.3 ) this.drifting = false;

			if ( this.drifting ) {

				// Handbrake: near-zero rear grip so the back slides freely
				const targetRearGrip = handbrake ? cfg.driftGripRear * 0.15 : cfg.driftGripRear;
				this.currentRearGrip = lerp( this.currentRearGrip, targetRearGrip, 1 - Math.exp( - 8 * dt ) );

			} else {

				this.currentRearGrip = lerp( this.currentRearGrip, cfg.gripRear, 1 - Math.exp( - cfg.gripRecoveryRate * dt ) );

			}

			const gripStrength = ( this.drifting ? this.currentRearGrip : cfg.gripFront ) * _effectiveGrip;
			const latForce = - latSpeed * gripStrength * cfg.mass;
			this._pushForce( this._right[ 0 ] * latForce, 0, this._right[ 2 ] * latForce, cx, cy, cz );

			this.driftIntensity = clamp( Math.abs( latSpeed ) * 1.5, 0, 1 );

		} else {

			this.driftIntensity = 0;

		}

		// ── 6. Anti-roll ─────────────────────────────────────────

		const frontDiff = this._suspCompression[ FL ] - this._suspCompression[ FR ];
		if ( Math.abs( frontDiff ) > EPSILON ) {

			const arf = frontDiff * cfg.antiRollStiffness;
			const wFL = this._wheelWorldPos[ FL ], wFR = this._wheelWorldPos[ FR ];
			this._pushForce( 0, - arf, 0, wFL[ 0 ], wFL[ 1 ], wFL[ 2 ] );
			this._pushForce( 0, arf, 0, wFR[ 0 ], wFR[ 1 ], wFR[ 2 ] );

		}

		const rearDiff = this._suspCompression[ BL ] - this._suspCompression[ BR ];
		if ( Math.abs( rearDiff ) > EPSILON ) {

			const arf = rearDiff * cfg.antiRollStiffness;
			const wBL = this._wheelWorldPos[ BL ], wBR = this._wheelWorldPos[ BR ];
			this._pushForce( 0, - arf, 0, wBL[ 0 ], wBL[ 1 ], wBL[ 2 ] );
			this._pushForce( 0, arf, 0, wBR[ 0 ], wBR[ 1 ], wBR[ 2 ] );

		}

		// ── 7. Upright correction + pitch/roll damping ───────────

		const upY = this._up[ 1 ];

		if ( upY < 0.98 && groundedCount > 0 ) {

			v3Cross( this._tmp1, this._up, [ 0, 1, 0 ] );
			const sinAngle = v3Len( this._tmp1 );
			if ( sinAngle > EPSILON ) {

				v3Normalize( this._tmp1, this._tmp1 );
				v3Scale( this._tmp1, this._tmp1, 2000 * sinAngle );
				this._pushTorque( this._tmp1[ 0 ], this._tmp1[ 1 ], this._tmp1[ 2 ] );

			}

		}

		// Always damp pitch/roll to keep chassis planted
		if ( groundedCount > 0 ) {

			const pitchRate = v3Dot( chassis.angularVelocity, this._right );
			const rollRate = v3Dot( chassis.angularVelocity, this._forward );
			const dampPitch = - pitchRate * 800;
			const dampRoll = - rollRate * 800;
			this._pushTorque(
				this._right[ 0 ] * dampPitch + this._forward[ 0 ] * dampRoll,
				this._right[ 1 ] * dampPitch + this._forward[ 1 ] * dampRoll,
				this._right[ 2 ] * dampPitch + this._forward[ 2 ] * dampRoll
			);

		}

		// ── 8. Wheel spin ────────────────────────────────────────

		const spinDelta = ( speed / Math.max( cfg.wheelRadius, 0.01 ) ) * dt;
		for ( let i = 0; i < 4; i ++ ) {

			if ( this._grounded[ i ] ) this.wheelSpin[ i ] += spinDelta;

		}

		// ── Output (zero-alloc) ──────────────────────────────────

		for ( let i = 0; i < 4; i ++ ) {

			const wd = this._wheelData[ i ];
			wd.compression = this._suspCompression[ i ];
			wd.steerAngle = ( i === FL || i === FR ) ? this.currentSteerAngle : 0;
			wd.spin = this.wheelSpin[ i ];
			wd.grounded = this._grounded[ i ];

		}

		const r = this._result;
		r.forces = this._forces;
		r.forceCount = this._forceCount;
		r.torques = this._torques;
		r.torqueCount = this._torqueCount;
		r.driftIntensity = this.driftIntensity;
		r.linearSpeed = speed;
		return r;

	}

	reset() {

		this.prevCompression = [ 0, 0, 0, 0 ];
		this.wheelSpin = [ 0, 0, 0, 0 ];
		this.currentSteerAngle = 0;
		this.drifting = false;
		this.currentRearGrip = this.cfg.gripRear;
		this.driftIntensity = 0;

	}

}
