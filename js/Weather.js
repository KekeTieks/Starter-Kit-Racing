import * as THREE from 'three';
import { CELL_RAW, GRID_SCALE, TRACK_CELLS } from './Track.js';

// ── Visual targets per weather type ─────────────────────────────────────────
// fogNear/fogFar are multipliers applied to the track baseline fog values.
// Absolute light/bloom values replace the scene defaults.

const WEATHER_VISUALS = {
	clear: {
		fogNearMult:  1.0, fogFarMult:  1.0, fogColor: new THREE.Color( 0xadb2ba ),
		dirIntensity: 5.0, hemiIntensity: 1.5,
		bloomStrength: 0.02,
		rain: 0,
		puddleOpacity: 0,
	},
	rain: {
		fogNearMult:  0.5, fogFarMult:  0.64, fogColor: new THREE.Color( 0x7a8a94 ),
		dirIntensity: 2.5, hemiIntensity: 0.8,
		bloomStrength: 0.01,
		rain: 1,
		puddleOpacity: 0.55,
	},
	fog: {
		fogNearMult:  0.27, fogFarMult: 0.4, fogColor: new THREE.Color( 0xc8ccce ),
		dirIntensity: 3.0, hemiIntensity: 1.0,
		bloomStrength: 0.015,
		rain: 0,
		puddleOpacity: 0,
	},
	storm: {
		fogNearMult:  0.33, fogFarMult: 0.51, fogColor: new THREE.Color( 0x5a6570 ),
		dirIntensity: 1.5, hemiIntensity: 0.5,
		bloomStrength: 0.008,
		rain: 1,
		puddleOpacity: 0.75,
	},
	night: {
		fogNearMult:  0.6, fogFarMult: 0.75, fogColor: new THREE.Color( 0x05080f ),
		dirIntensity: 0.0, hemiIntensity: 0.04,
		bloomStrength: 0.06,
		rain: 0,
		puddleOpacity: 0,
	},
};

const LERP_SPEED = 1.5;   // transitions take ~0.7s
const RAIN_POOL_SIZE = 300;
const _dummy = new THREE.Object3D();

// ── Rain particle pool ───────────────────────────────────────────────────────

class RainPool {

	constructor( scene ) {

		this._scene = scene;
		this._opacity = 0;

		// Generate a 4×16 white-to-transparent gradient texture
		const canvas = document.createElement( 'canvas' );
		canvas.width = 4; canvas.height = 16;
		const ctx = canvas.getContext( '2d' );
		const grad = ctx.createLinearGradient( 0, 0, 0, 16 );
		grad.addColorStop( 0,    'rgba(200,220,255,0)' );
		grad.addColorStop( 0.15, 'rgba(200,220,255,0.9)' );
		grad.addColorStop( 0.85, 'rgba(200,220,255,0.9)' );
		grad.addColorStop( 1,    'rgba(200,220,255,0)' );
		ctx.fillStyle = grad;
		ctx.fillRect( 0, 0, 4, 16 );
		const tex = new THREE.CanvasTexture( canvas );

		const geo = new THREE.PlaneGeometry( 0.04, 0.3 );
		const mat = new THREE.MeshBasicMaterial( {
			map: tex,
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
		} );

		this._mesh = new THREE.InstancedMesh( geo, mat, RAIN_POOL_SIZE );
		this._mesh.frustumCulled = false;
		scene.add( this._mesh );

		// Per-particle state
		this._pos = new Float32Array( RAIN_POOL_SIZE * 3 );
		this._vel = new Float32Array( RAIN_POOL_SIZE * 3 );
		this._life = new Float32Array( RAIN_POOL_SIZE );
		this._maxLife = new Float32Array( RAIN_POOL_SIZE );

		this._windX = 0;
		this._cameraPos = new THREE.Vector3();

		// Spread initial positions so rain appears immediately on setWeather
		for ( let i = 0; i < RAIN_POOL_SIZE; i++ ) this._resetParticle( i, true );

	}

	setWind( wx ) {

		this._windX = wx;

	}

	_resetParticle( i, randomizeY ) {

		const cx = this._cameraPos.x, cz = this._cameraPos.z;
		this._pos[ i * 3 ]     = cx + ( Math.random() - 0.5 ) * 30;
		this._pos[ i * 3 + 1 ] = randomizeY
			? this._cameraPos.y + 2 + Math.random() * 12
			: this._cameraPos.y + 14 + Math.random() * 6;
		this._pos[ i * 3 + 2 ] = cz + ( Math.random() - 0.5 ) * 30;

		this._vel[ i * 3 ]     = this._windX;
		this._vel[ i * 3 + 1 ] = -( 8 + Math.random() * 5 ); // fall speed
		this._vel[ i * 3 + 2 ] = 0;

		this._maxLife[ i ] = 1.0 + Math.random() * 0.8;
		this._life[ i ]    = randomizeY ? Math.random() * this._maxLife[ i ] : this._maxLife[ i ];

	}

	update( dt, cameraPos, targetOpacity ) {

		this._cameraPos.copy( cameraPos );

		// Lerp rain opacity
		this._opacity += ( targetOpacity - this._opacity ) * ( 1 - Math.exp( -dt * 2.5 ) );
		this._mesh.material.opacity = this._opacity;

		if ( this._opacity < 0.01 ) {

			// Hide all instances when fully faded out
			_dummy.scale.setScalar( 0 );
			_dummy.updateMatrix();
			for ( let i = 0; i < RAIN_POOL_SIZE; i++ ) this._mesh.setMatrixAt( i, _dummy.matrix );
			this._mesh.instanceMatrix.needsUpdate = true;
			return;

		}

		for ( let i = 0; i < RAIN_POOL_SIZE; i++ ) {

			this._life[ i ] -= dt;

			if ( this._life[ i ] <= 0 ) {

				this._resetParticle( i, false );

			}

			this._pos[ i * 3 ]     += this._vel[ i * 3 ]     * dt;
			this._pos[ i * 3 + 1 ] += this._vel[ i * 3 + 1 ] * dt;
			this._pos[ i * 3 + 2 ] += this._vel[ i * 3 + 2 ] * dt;

			_dummy.position.set(
				this._pos[ i * 3 ],
				this._pos[ i * 3 + 1 ],
				this._pos[ i * 3 + 2 ],
			);

			// Tilt the billboard slightly in the wind direction
			_dummy.rotation.set( 0, 0, -this._windX * 0.08 );
			_dummy.scale.setScalar( 1 );
			_dummy.updateMatrix();
			this._mesh.setMatrixAt( i, _dummy.matrix );

		}

		this._mesh.instanceMatrix.needsUpdate = true;

	}

	dispose() {

		this._scene.remove( this._mesh );
		this._mesh.geometry.dispose();
		this._mesh.material.map.dispose();
		this._mesh.material.dispose();

	}

}

// ── Lightning system ─────────────────────────────────────────────────────────
// During storm: random flashes that briefly spike dirLight + a fill PointLight.

class LightningSystem {

	/**
	 * @param {THREE.Scene}            scene
	 * @param {THREE.DirectionalLight} dirLight  — the main directional light (intensity spiked during flash)
	 */
	constructor( scene, dirLight ) {

		this._dirLight  = dirLight;
		this._active    = false;

		// Flash state machine
		this._nextFlash    = this._randomDelay();  // time until next flash
		this._flashTimer   = 0;                    // countdown while flashing
		this._flashPhase   = 'idle';               // 'idle' | 'flash1' | 'gap' | 'flash2'
		this._baseDirIntensity = dirLight.intensity;

		// Short-range fill light for the flash bloom
		this._fillLight = new THREE.PointLight( 0xd0e8ff, 0, 80 );
		this._fillLight.position.set( 0, 20, 0 );
		scene.add( this._fillLight );

	}

	setActive( active ) {

		this._active = active;
		if ( ! active ) {

			this._fillLight.intensity = 0;
			this._flashPhase = 'idle';
			this._nextFlash  = this._randomDelay();

		}

	}

	/** Call every frame. Returns extra dirLight intensity to ADD for this frame (0 when not flashing). */
	update( dt, baseDirIntensity ) {

		this._baseDirIntensity = baseDirIntensity;

		if ( ! this._active ) {

			this._fillLight.intensity = 0;
			return 0;

		}

		this._nextFlash -= dt;

		if ( this._flashPhase === 'idle' ) {

			if ( this._nextFlash <= 0 ) {

				// Start a double-flash (50% chance) or single flash
				this._flashPhase  = 'flash1';
				this._flashTimer  = 0.06 + Math.random() * 0.05; // 60-110ms
				this._doDouble    = Math.random() < 0.5;

			}

			this._fillLight.intensity = 0;
			return 0;

		}

		if ( this._flashPhase === 'flash1' ) {

			this._flashTimer -= dt;
			const intensity = 28 + Math.random() * 12;
			this._fillLight.intensity = intensity * 0.6;

			if ( this._flashTimer <= 0 ) {

				if ( this._doDouble ) {

					this._flashPhase = 'gap';
					this._flashTimer = 0.04 + Math.random() * 0.03; // 40-70ms gap

				} else {

					this._flashPhase = 'idle';
					this._nextFlash  = this._randomDelay();

				}

			}

			return intensity;

		}

		if ( this._flashPhase === 'gap' ) {

			this._flashTimer -= dt;
			this._fillLight.intensity = 0;

			if ( this._flashTimer <= 0 ) {

				this._flashPhase = 'flash2';
				this._flashTimer = 0.04 + Math.random() * 0.04;

			}

			return 0;

		}

		if ( this._flashPhase === 'flash2' ) {

			this._flashTimer -= dt;
			const intensity = 20 + Math.random() * 10;
			this._fillLight.intensity = intensity * 0.5;

			if ( this._flashTimer <= 0 ) {

				this._flashPhase = 'idle';
				this._nextFlash  = this._randomDelay();

			}

			return intensity;

		}

		return 0;

	}

	_randomDelay() {

		return 2.5 + Math.random() * 5; // 2.5 – 7.5s between flashes

	}

	dispose( scene ) {

		scene.remove( this._fillLight );

	}

}

// ── Puddle system ────────────────────────────────────────────────────────────
// Reflective water puddles that appear on track cells during rain/storm.

class PuddleSystem {

	/**
	 * @param {THREE.Scene} scene
	 * @param {Array}       trackCells  — raw cell array [[gx, gz, type, orient], ...]
	 */
	constructor( scene, trackCells ) {

		this._scene   = scene;
		this._opacity = 0;
		this._meshes  = [];

		const cells = trackCells || TRACK_CELLS;
		if ( cells.length === 0 ) return;

		const S = CELL_RAW * GRID_SCALE;

		// One large shared puddle geometry per cell
		// Use a slightly smaller plane than the cell to stay inside road edges
		const patchSize = S * 0.55;
		const geo = new THREE.PlaneGeometry( patchSize, patchSize );

		const mat = new THREE.MeshStandardMaterial( {
			color:      0x4a6880,
			roughness:  0.05,
			metalness:  0.9,
			transparent: true,
			opacity:     0,
			depthWrite:  false,
			blending:   THREE.NormalBlending,
		} );

		// Track cells only (no decorations)
		const TRACK_TYPES = new Set( [ 'track-straight', 'track-corner', 'track-bump', 'track-finish' ] );

		for ( const cell of cells ) {

			const type = cell[ 2 ];
			if ( ! TRACK_TYPES.has( type ) ) continue;

			const gx = cell[ 0 ];
			const gz = cell[ 1 ];

			// World position (track group sits at y=-0.5, road surface is y≈0)
			const wx = ( gx + 0.5 ) * S;
			const wz = ( gz + 0.5 ) * S;

			// Scatter 2-4 small irregular puddle patches per cell
			const count = 2 + Math.floor( Math.random() * 3 );
			for ( let p = 0; p < count; p++ ) {

				const mesh = new THREE.Mesh( geo, mat );

				// Random offset within the cell
				const ox = ( Math.random() - 0.5 ) * S * 0.35;
				const oz = ( Math.random() - 0.5 ) * S * 0.35;
				// Flatten onto the road surface with a tiny offset above ground
				mesh.rotation.x = -Math.PI / 2;
				mesh.position.set( wx + ox, -0.47, wz + oz );

				// Random scale + rotation for variation
				const sx = 0.3 + Math.random() * 0.55;
				const sz = 0.25 + Math.random() * 0.45;
				mesh.scale.set( sx, sz, 1 );
				mesh.rotation.z = Math.random() * Math.PI;

				scene.add( mesh );
				this._meshes.push( mesh );

			}

		}

		this._mat = mat;

	}

	update( dt, targetOpacity ) {

		if ( this._meshes.length === 0 ) return;

		this._opacity += ( targetOpacity - this._opacity ) * ( 1 - Math.exp( -dt * 0.8 ) );
		this._mat.opacity = this._opacity;

	}

	dispose() {

		for ( const mesh of this._meshes ) this._scene.remove( mesh );
		if ( this._mat ) {

			this._mat.dispose();
			// geometry shared — dispose once
			if ( this._meshes.length > 0 ) this._meshes[ 0 ].geometry.dispose();

		}

		this._meshes = [];

	}

}

// ── WeatherController ────────────────────────────────────────────────────────

export class WeatherController {

	/**
	 * @param {object} refs
	 * @param {THREE.Scene}            refs.scene
	 * @param {THREE.Fog}              refs.fog
	 * @param {THREE.DirectionalLight} refs.dirLight
	 * @param {THREE.HemisphereLight}  refs.hemiLight
	 * @param {UnrealBloomPass}        refs.bloomPass
	 * @param {number} refs.baseFogNear   - baseline fog.near from setupScene
	 * @param {number} refs.baseFogFar    - baseline fog.far from setupScene
	 * @param {Array}  [refs.trackCells]  - raw cell array for puddle placement
	 */
	constructor( { scene, fog, dirLight, hemiLight, bloomPass, baseFogNear = 30, baseFogFar = 55, trackCells = null } ) {

		this._scene    = scene;
		this._fog      = fog;
		this._dirLight = dirLight;
		this._hemiLight = hemiLight;
		this._bloom    = bloomPass;
		this._baseFogNear = baseFogNear;
		this._baseFogFar  = baseFogFar;

		this._rainPool    = new RainPool( scene );
		this._lightning   = new LightningSystem( scene, dirLight );
		this._puddles     = new PuddleSystem( scene, trackCells );

		// Sky color: day default vs night
		this._skyDay   = new THREE.Color( 0xadb2ba );
		this._skyNight = new THREE.Color( 0x05080f );
		this._skyCur   = new THREE.Color( 0xadb2ba );

		// Current interpolated values
		this._cur = {
			fogNear:      baseFogNear,
			fogFar:       baseFogFar,
			fogColor:     new THREE.Color( 0xadb2ba ),
			dirIntensity: 5.0,
			hemiIntensity: 1.5,
			bloomStrength: 0.02,
			rain:          0,
			puddleOpacity: 0,
		};

		// Target values (set by setWeather)
		this._target = { ...this._cur, fogColor: new THREE.Color( 0xadb2ba ) };
		this._weatherType = 'clear';

	}

	/** True when the current weather is night (used by main.js to auto-enable headlights). */
	get isNight() { return this._weatherType === 'night'; }

	/** Update baseline fog values when a new track is loaded. */
	setBaseFog( near, far ) {

		this._baseFogNear = near;
		this._baseFogFar  = far;
		// Re-apply current weather with new baseline
		this.setWeather( this._weatherType );

	}

	setWeather( type ) {

		this._weatherType = type;
		const v = WEATHER_VISUALS[ type ] ?? WEATHER_VISUALS.clear;

		this._target.fogNear       = this._baseFogNear * v.fogNearMult;
		this._target.fogFar        = this._baseFogFar  * v.fogFarMult;
		this._target.fogColor      = v.fogColor;
		this._target.dirIntensity  = v.dirIntensity;
		this._target.hemiIntensity = v.hemiIntensity;
		this._target.bloomStrength = v.bloomStrength;
		this._target.rain          = v.rain;
		this._target.puddleOpacity = v.puddleOpacity;

		// Randomize wind per weather change (more wind in storm)
		const windMag = type === 'storm' ? 0.8 : ( type === 'rain' ? 0.3 : 0 );
		this._rainPool.setWind( ( Math.random() - 0.5 ) * 2 * windMag );

		// Activate/deactivate lightning
		this._lightning.setActive( type === 'storm' );

	}

	/** Must be called every frame in the game loop, before renderer.render(). */
	update( dt, cameraPos ) {

		const c = this._cur;
		const t = this._target;
		const k = 1 - Math.exp( -dt * LERP_SPEED );

		// Fog geometry
		c.fogNear += ( t.fogNear - c.fogNear ) * k;
		c.fogFar  += ( t.fogFar  - c.fogFar  ) * k;
		this._fog.near = c.fogNear;
		this._fog.far  = c.fogFar;

		// Fog + sky color
		c.fogColor.lerp( t.fogColor, k );
		this._fog.color.copy( c.fogColor );
		const skyTarget = this._weatherType === 'night' ? this._skyNight : this._skyDay;
		this._skyCur.lerp( skyTarget, k );
		this._scene.background = this._skyCur;

		// Lights (base values, before lightning spike)
		c.dirIntensity  += ( t.dirIntensity  - c.dirIntensity  ) * k;
		c.hemiIntensity += ( t.hemiIntensity - c.hemiIntensity ) * k;
		this._hemiLight.intensity = c.hemiIntensity;

		// Lightning: returns extra intensity to add to dirLight this frame
		const lightningBoost = this._lightning.update( dt, c.dirIntensity );
		this._dirLight.intensity = c.dirIntensity + lightningBoost;

		// Bloom
		c.bloomStrength += ( t.bloomStrength - c.bloomStrength ) * ( 1 - Math.exp( -dt * 2 ) );
		this._bloom.strength = c.bloomStrength;

		// Rain particles
		this._rainPool.update( dt, cameraPos, t.rain );

		// Puddles
		this._puddles.update( dt, t.puddleOpacity );

	}

	dispose() {

		this._rainPool.dispose();
		this._lightning.dispose( this._scene );
		this._puddles.dispose();

	}

}
