import * as THREE from 'three';

const POOL_SIZE = 64;
const NITRO_POOL_SIZE = 80;
const _worldPos = new THREE.Vector3();
const _backward = new THREE.Vector3();

export class SmokeTrails {

	constructor( scene ) {

		this.particles = [];

		const map = new THREE.TextureLoader().load( 'sprites/smoke.png' );
		this.material = new THREE.SpriteMaterial( {
			map,
			transparent: true,
			depthWrite: false,
			opacity: 0,
			color: 0x5E5F6B,
		} );

		for ( let i = 0; i < POOL_SIZE; i ++ ) {

			const sprite = new THREE.Sprite( this.material.clone() );
			sprite.visible = false;
			sprite.scale.setScalar( 0.25 );
			scene.add( sprite );

			this.particles.push( {
				sprite,
				life: 0,
				maxLife: 0,
				velocity: new THREE.Vector3(),
				initialScale: 0,
			} );

		}

		this.emitIndex = 0;

	}

	update( dt, vehicle ) {

		const shouldEmit = vehicle.driftIntensity > 0.25;

		// Emit new particles from back wheel positions
		if ( shouldEmit ) {

			if ( vehicle.wheelBL ) this.emitAtWheel( vehicle.wheelBL, vehicle );
			if ( vehicle.wheelBR ) this.emitAtWheel( vehicle.wheelBR, vehicle );

		}

		// Update existing
		for ( const p of this.particles ) {

			if ( p.life <= 0 ) continue;

			p.life -= dt;

			if ( p.life <= 0 ) {

				p.sprite.visible = false;
				continue;

			}

			const t = 1 - ( p.life / p.maxLife );

			// Apply damping to velocity (Godot damping = 1.0)
			const damping = Math.max( 0, 1 - dt );
			p.velocity.multiplyScalar( damping );

			p.sprite.position.addScaledVector( p.velocity, dt );

			// Alpha curve: 0 → 1 (at midlife) → 0 (matching Godot's alpha_curve)
			const alpha = t < 0.5 ? t * 2 : ( 1 - t ) * 2;
			p.sprite.material.opacity = alpha;

			// Scale curve: 0.5 → 1.0 (at midlife) → 0.2 (matching Godot's scale_curve)
			let scaleFactor;
			if ( t < 0.5 ) {

				scaleFactor = 0.5 + t * 1.0; // 0.5 → 1.0

			} else {

				scaleFactor = 1.0 - ( t - 0.5 ) * 1.6; // 1.0 → 0.2

			}

			p.sprite.scale.setScalar( p.initialScale * scaleFactor );

		}

	}

	dispose( scene ) {

		for ( const p of this.particles ) {

			p.sprite.material.dispose();
			scene.remove( p.sprite );

		}

		this.particles = [];

	}

	emitAtWheel( wheel, vehicle ) {

		const p = this.particles[ this.emitIndex ];
		this.emitIndex = ( this.emitIndex + 1 ) % POOL_SIZE;

		// Get wheel world position, but use road surface Y
		wheel.getWorldPosition( _worldPos );
		_worldPos.y = vehicle.container.position.y + 0.05;

		p.sprite.position.copy( _worldPos );
		p.sprite.visible = true;
		p.sprite.material.opacity = 0;

		// Godot: scale_min = 0.25, scale_max = 0.5
		p.initialScale = 0.25 + Math.random() * 0.25;
		p.sprite.scale.setScalar( p.initialScale * 0.5 );

		// Godot: no gravity, damping = 1.0 — minimal velocity
		p.velocity.set(
			( Math.random() - 0.5 ) * 0.2,
			Math.random() * 0.1,
			( Math.random() - 0.5 ) * 0.2
		);

		// Godot: lifetime = 0.5
		p.maxLife = 0.5;
		p.life = p.maxLife;

	}

}

// ── Nitro flame particles ───────────────────────────────────────────────────

// Hot color palette: white-core → yellow → orange → red tip
const _NITRO_COLORS = [
	new THREE.Color( 0xffffff ),
	new THREE.Color( 0xffee55 ),
	new THREE.Color( 0xff8800 ),
	new THREE.Color( 0xff3300 ),
];

function _nitroGlowTexture() {

	const size = 64;
	const canvas = document.createElement( 'canvas' );
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext( '2d' );
	const grad = ctx.createRadialGradient( size / 2, size / 2, 0, size / 2, size / 2, size / 2 );
	grad.addColorStop( 0, 'rgba(255,255,255,1)' );
	grad.addColorStop( 0.3, 'rgba(255,200,60,0.8)' );
	grad.addColorStop( 0.7, 'rgba(255,100,0,0.3)' );
	grad.addColorStop( 1, 'rgba(255,50,0,0)' );
	ctx.fillStyle = grad;
	ctx.fillRect( 0, 0, size, size );
	const tex = new THREE.CanvasTexture( canvas );
	return tex;

}

export class NitroFX {

	constructor( scene ) {

		this._scene = scene;
		this.particles = [];

		const map = _nitroGlowTexture();

		for ( let i = 0; i < NITRO_POOL_SIZE; i ++ ) {

			const mat = new THREE.SpriteMaterial( {
				map,
				transparent: true,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				opacity: 0,
				color: 0xffffff,
			} );

			const sprite = new THREE.Sprite( mat );
			sprite.visible = false;
			sprite.scale.setScalar( 0.15 );
			scene.add( sprite );

			this.particles.push( {
				sprite,
				life: 0,
				maxLife: 0,
				velocity: new THREE.Vector3(),
				initialScale: 0,
			} );

		}

		this.emitIndex = 0;
		this._emitAccum = 0;

	}

	update( dt, vehicle ) {

		const active = vehicle.nitroActive;

		if ( active ) {

			// Emit ~120 particles/sec from both rear wheels
			this._emitAccum += dt;
			const interval = 1 / 120;

			while ( this._emitAccum >= interval ) {

				this._emitAccum -= interval;
				if ( vehicle.wheelBL ) this._emit( vehicle.wheelBL, vehicle );
				if ( vehicle.wheelBR ) this._emit( vehicle.wheelBR, vehicle );

			}

		} else {

			this._emitAccum = 0;

		}

		// Tick existing
		for ( const p of this.particles ) {

			if ( p.life <= 0 ) continue;

			p.life -= dt;

			if ( p.life <= 0 ) {

				p.sprite.visible = false;
				continue;

			}

			const t = 1 - ( p.life / p.maxLife ); // 0→1

			// Move
			p.velocity.y += dt * 0.5; // slight upward drift
			p.sprite.position.addScaledVector( p.velocity, dt );

			// Alpha: quick fade in, then fade out
			const alpha = t < 0.1 ? t / 0.1 : 1 - ( t - 0.1 ) / 0.9;
			p.sprite.material.opacity = alpha * 0.85;

			// Scale: grow then shrink
			const scale = t < 0.3
				? p.initialScale * ( 0.6 + t * 1.3 )
				: p.initialScale * ( 1 - ( t - 0.3 ) * 0.8 );
			p.sprite.scale.setScalar( Math.max( 0.02, scale ) );

			// Color: interpolate white→yellow→orange→red along lifetime
			const ci = t * ( _NITRO_COLORS.length - 1 );
			const idx = Math.min( Math.floor( ci ), _NITRO_COLORS.length - 2 );
			const frac = ci - idx;
			p.sprite.material.color.copy( _NITRO_COLORS[ idx ] ).lerp( _NITRO_COLORS[ idx + 1 ], frac );

		}

	}

	_emit( wheel, vehicle ) {

		const p = this.particles[ this.emitIndex ];
		this.emitIndex = ( this.emitIndex + 1 ) % NITRO_POOL_SIZE;

		wheel.getWorldPosition( _worldPos );
		_worldPos.y = vehicle.container.position.y + 0.12;

		p.sprite.position.copy( _worldPos );
		p.sprite.visible = true;
		p.sprite.material.opacity = 0;

		p.initialScale = 0.12 + Math.random() * 0.15;
		p.sprite.scale.setScalar( p.initialScale * 0.6 );

		// Backward direction from vehicle
		_backward.set( 0, 0, - 1 ).applyQuaternion( vehicle.container.quaternion );

		// Velocity: mostly backward + some random spread
		const speed = 1.5 + Math.random() * 1.0;
		p.velocity.set(
			_backward.x * speed + ( Math.random() - 0.5 ) * 0.6,
			( Math.random() - 0.3 ) * 0.3,
			_backward.z * speed + ( Math.random() - 0.5 ) * 0.6
		);

		p.maxLife = 0.25 + Math.random() * 0.2;
		p.life = p.maxLife;

	}

	dispose( scene ) {

		for ( const p of this.particles ) {

			p.sprite.material.map?.dispose();
			p.sprite.material.dispose();
			scene.remove( p.sprite );

		}

		this.particles = [];

	}

}
