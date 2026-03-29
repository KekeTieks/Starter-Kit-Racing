import nipplejs from 'nipplejs';

export class Controls {

	constructor() {

		this.keys = {};
		this.x = 0;
		this.z = 0;

		// Touch state (set by nipplejs)
		this.touchActive = false;
		this.touchDirX   = 0;
		this.touchDirY   = 0;

		this.handbrake = false;

		window.addEventListener( 'keydown', ( e ) => this.keys[ e.code ] = true );
		window.addEventListener( 'keyup',   ( e ) => this.keys[ e.code ] = false );

		this._setupTouchUI();

	}

	_setupTouchUI() {

		if ( ! ( 'ontouchstart' in window ) ) return;

		// Full-screen touch zone — nipplejs positions itself where the user taps
		const zone = document.createElement( 'div' );
		zone.style.cssText = [
			'position:absolute', 'inset:0', 'z-index:10',
			'pointer-events:auto', 'touch-action:none',
		].join( ';' );
		document.body.appendChild( zone );
		this._touchZone = zone;

		const joystick = nipplejs.create( {
			zone,
			mode:           'dynamic',   // appears where you touch
			restOpacity:    0.6,
			color:          'white',
			size:           120,
			threshold:      0.1,
			fadeTime:       150,
		} );

		joystick.on( 'start', () => {

			this.touchActive = true;
			this.touchDirX   = 0;
			this.touchDirY   = 0;

		} );

		joystick.on( 'move', ( _e, data ) => {

			// data.vector: { x, y } normalised, y is up-positive
			this.touchDirX =   data.vector.x;
			this.touchDirY = - data.vector.y; // invert so +y = down-screen

		} );

		joystick.on( 'end', () => {

			this.touchActive = false;
			this.touchDirX   = 0;
			this.touchDirY   = 0;

		} );

		this._joystick = joystick;

	}

	/** Call when the game ends / lobby is shown to remove the joystick overlay */
	destroyTouchUI() {

		if ( this._joystick ) { this._joystick.destroy(); this._joystick = null; }
		if ( this._touchZone ) { this._touchZone.remove(); this._touchZone = null; }

	}

	update() {

		let x = 0, z = 0;

		// ── Keyboard ────────────────────────────────────────────
		if ( this.keys[ 'KeyA' ] || this.keys[ 'ArrowLeft' ] )  x -= 1;
		if ( this.keys[ 'KeyD' ] || this.keys[ 'ArrowRight' ] ) x += 1;
		if ( this.keys[ 'KeyW' ] || this.keys[ 'ArrowUp' ] )    z += 1;
		if ( this.keys[ 'KeyS' ] || this.keys[ 'ArrowDown' ] )  z -= 1;

		// ── Gamepad ─────────────────────────────────────────────
		const gamepads = navigator.getGamepads();
		for ( const gp of gamepads ) {

			if ( ! gp ) continue;
			const stickX = gp.axes[ 0 ];
			if ( Math.abs( stickX ) > 0.15 ) x = stickX;
			const rt = gp.buttons[ 7 ] ? gp.buttons[ 7 ].value : 0;
			const lt = gp.buttons[ 6 ] ? gp.buttons[ 6 ].value : 0;
			if ( rt > 0.1 || lt > 0.1 ) z = rt - lt;
			break;

		}

		// ── Touch (nipplejs) ────────────────────────────────────
		// Camera is 45° azimuth — rotate joystick vector to match world space
		if ( this.touchActive ) {

			const jx  = this.touchDirX;
			const jy  = this.touchDirY;
			const mag = Math.sqrt( jx * jx + jy * jy );

			if ( mag > 0.1 ) {

				x = ( jx + jy ) * Math.SQRT1_2;
				z = ( - jx + jy ) * Math.SQRT1_2;

			}

		}

		// ── Handbrake ────────────────────────────────────────
		let handbrake = !! this.keys[ 'Space' ];

		// Gamepad: B button (index 1)
		const gamepads2 = navigator.getGamepads();
		for ( const gp of gamepads2 ) {

			if ( ! gp ) continue;
			if ( gp.buttons[ 1 ] && gp.buttons[ 1 ].pressed ) handbrake = true;
			break;

		}

		this.x = x;
		this.z = z;
		this.handbrake = handbrake;

		return { x, z, touchActive: this.touchActive, handbrake };

	}

}
