const STORAGE_KEY = 'myrace-keybindings';

const DEFAULTS = {
	forward:    [ 'KeyW', 'ArrowUp' ],
	backward:   [ 'KeyS', 'ArrowDown' ],
	left:       [ 'KeyA', 'ArrowLeft' ],
	right:      [ 'KeyD', 'ArrowRight' ],
	handbrake:  [ 'Space' ],
	nitro:      [ 'ShiftLeft', 'ShiftRight' ],
	headlights: [ 'KeyL' ],
};

const ACTION_LABELS = {
	forward:    'Forward',
	backward:   'Backward',
	left:       'Left',
	right:      'Right',
	handbrake:  'Handbrake',
	nitro:      'Nitro',
	headlights: 'Headlights',
};

class KeyBindingsService {

	constructor() {

		this.bindings = this._load();

	}

	_load() {

		try {

			const raw = localStorage.getItem( STORAGE_KEY );
			if ( raw ) {

				const parsed = JSON.parse( raw );
				// Merge with defaults so new actions always exist
				const merged = {};
				for ( const action of Object.keys( DEFAULTS ) ) {

					merged[ action ] = parsed[ action ] || [ ...DEFAULTS[ action ] ];

				}

				return merged;

			}

		} catch ( e ) { /* ignore */ }

		return this._defaults();

	}

	_defaults() {

		const copy = {};
		for ( const key of Object.keys( DEFAULTS ) ) {

			copy[ key ] = [ ...DEFAULTS[ key ] ];

		}

		return copy;

	}

	_save() {

		localStorage.setItem( STORAGE_KEY, JSON.stringify( this.bindings ) );

	}

	/** Get the key codes array for an action */
	getKeys( action ) {

		return this.bindings[ action ] || [];

	}

	/** Check if a KeyboardEvent.code matches an action */
	isAction( action, code ) {

		return ( this.bindings[ action ] || [] ).includes( code );

	}

	/** Set the keys for an action */
	setKeys( action, codes ) {

		this.bindings[ action ] = codes;
		this._save();

	}

	/** Reset all bindings to defaults */
	resetAll() {

		this.bindings = this._defaults();
		this._save();

	}

	/** Get all actions and their labels */
	getActions() {

		return Object.keys( DEFAULTS ).map( ( action ) => ( {
			action,
			label: ACTION_LABELS[ action ],
			keys: this.bindings[ action ] || [],
		} ) );

	}

}

/** Pretty-print a KeyboardEvent.code for display */
export function keyDisplayName( code ) {

	if ( ! code ) return '';
	// Common overrides
	const map = {
		'Space':      'Space',
		'ShiftLeft':  'L-Shift',
		'ShiftRight': 'R-Shift',
		'ControlLeft':  'L-Ctrl',
		'ControlRight': 'R-Ctrl',
		'AltLeft':    'L-Alt',
		'AltRight':   'R-Alt',
		'ArrowUp':    '\u2191',
		'ArrowDown':  '\u2193',
		'ArrowLeft':  '\u2190',
		'ArrowRight': '\u2192',
		'Backspace':  'Backspace',
		'Tab':        'Tab',
		'Enter':      'Enter',
		'CapsLock':   'Caps',
	};

	if ( map[ code ] ) return map[ code ];
	if ( code.startsWith( 'Key' ) ) return code.slice( 3 );
	if ( code.startsWith( 'Digit' ) ) return code.slice( 5 );
	if ( code.startsWith( 'Numpad' ) ) return 'Num' + code.slice( 6 );
	return code;

}

export const keyBindings = new KeyBindingsService();
