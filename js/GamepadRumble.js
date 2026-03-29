// GamepadRumble.js — Haptic feedback via the Gamepad Vibration Actuator API

export class GamepadRumble {

	constructor() {

		// Queued one-shot effects (collision, nitro start, etc.)
		this._queue = [];

		// Continuous rumble state (drift, speed, nitro hold, throttle, brake)
		this._drift = 0;
		this._speed = 0;
		this._nitro = false;
		this._throttle = 0;
		this._brake = 0;

	}

	// ── One-shot effects ─────────────────────────────────────

	/** Wall / vehicle collision — intensity 0-1 based on impact speed */
	collision( intensity ) {

		const t = Math.min( intensity, 1 );
		this._queue.push( {
			duration: 120 + t * 80,
			weakMagnitude: t * 0.4,
			strongMagnitude: t * 1.0,
		} );

	}

	/** Nitro activation burst */
	nitroStart() {

		this._queue.push( {
			duration: 150,
			weakMagnitude: 0.5,
			strongMagnitude: 0.3,
		} );

	}

	// ── Continuous state (call every frame) ──────────────────

	setContinuous( driftIntensity, speedFraction, nitroActive, throttle, brake ) {

		this._drift = driftIntensity;
		this._speed = speedFraction;
		this._nitro = nitroActive;
		this._throttle = throttle || 0;
		this._brake = brake || 0;

	}

	// ── Flush to hardware (call once per frame) ──────────────

	update() {

		const gp = this._getGamepad();
		if ( ! gp ) return;

		const actuator = gp.vibrationActuator;
		if ( ! actuator || typeof actuator.playEffect !== 'function' ) return;

		// One-shot effects take priority
		if ( this._queue.length > 0 ) {

			const fx = this._queue.shift();
			actuator.playEffect( 'dual-rumble', {
				startDelay: 0,
				duration: fx.duration,
				weakMagnitude: fx.weakMagnitude,
				strongMagnitude: fx.strongMagnitude,
			} );
			return;

		}

		// Continuous rumble — blend drift + speed + nitro
		let weak = 0, strong = 0;

		// Drift: moderate rumble on both motors
		if ( this._drift > 0.15 ) {

			const d = Math.min( this._drift, 1 );
			weak   += d * 0.35;
			strong += d * 0.20;

		}

		// Nitro hold: steady vibration
		if ( this._nitro ) {

			weak   += 0.25;
			strong += 0.15;

		}

		// High speed: subtle low-frequency hum (strong motor only)
		if ( this._speed > 0.6 ) {

			const s = ( this._speed - 0.6 ) / 0.4; // 0-1 over [0.6, 1.0]
			strong += s * 0.10;

		}

		// Acceleration: light rumble on strong motor, scales with throttle × speed buildup
		if ( this._throttle > 0.1 ) {

			const accelFeel = this._throttle * ( 1 - this._speed * 0.6 ); // stronger at low speed
			strong += accelFeel * 0.12;
			weak   += accelFeel * 0.05;

		}

		// Braking: firm rumble on strong motor, proportional to brake input × current speed
		if ( this._brake > 0.1 ) {

			const brakeFeel = this._brake * this._speed;
			strong += brakeFeel * 0.25;
			weak   += brakeFeel * 0.10;

		}

		// Only send if there's something to feel
		if ( weak < 0.01 && strong < 0.01 ) return;

		actuator.playEffect( 'dual-rumble', {
			startDelay: 0,
			duration: 50, // short pulse, refreshed every frame
			weakMagnitude: Math.min( weak, 1 ),
			strongMagnitude: Math.min( strong, 1 ),
		} );

	}

	// ── Helpers ──────────────────────────────────────────────

	_getGamepad() {

		const gamepads = navigator.getGamepads();
		for ( const gp of gamepads ) {

			if ( gp ) return gp;

		}

		return null;

	}

}
