/**
 * VehicleCarousel
 * Renders each vehicle GLB into its own canvas using Three.js.
 * Used by the lobby vehicle-selection screen.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyCosmetics, stripCosmetics } from './CosmeticApplicator.js';

const VEHICLE_KEYS = [ 'yellow', 'green', 'purple', 'red' ];

const MODEL_PATH = ( key ) => `models/vehicle-truck-${ key }.glb`;

// Camera
const CAM_ELEVATION  = 22 * ( Math.PI / 180 );
const CAM_DISTANCE   = 3.0;
const CAM_AZIMUTH    = 25 * ( Math.PI / 180 );

export class VehicleCarousel {

	constructor( canvasContainer, vehicleKey ) {

		this._container = canvasContainer;
		this._key       = vehicleKey;
		this._raf       = null;
		this._disposed  = false;
		this._rotY      = 0;

		this._initRenderer();
		this._loadModel( vehicleKey );

	}

	_initRenderer() {

		const w = this._container.clientWidth  || 480;
		const h = this._container.clientHeight || 400;

		// ── Renderer ──────────────────────────────────────────────
		this._renderer = new THREE.WebGLRenderer( { antialias: true, alpha: true } );
		this._renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) );
		this._renderer.setSize( w, h );
		this._renderer.outputColorSpace = THREE.SRGBColorSpace;
		this._renderer.shadowMap.enabled = true;
		this._renderer.shadowMap.type = THREE.PCFShadowMap;
		this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this._renderer.toneMappingExposure = 1.1;
		this._container.appendChild( this._renderer.domElement );

		// ── Scene ─────────────────────────────────────────────────
		this._scene = new THREE.Scene();

		// ── Lights ────────────────────────────────────────────────

		// Warm ambient — enough to see the whole model without washing it
		const ambient = new THREE.AmbientLight( 0xfff4e0, 1.0 );
		this._scene.add( ambient );

		// Main key light — top-front-left, slightly warm
		const keyLight = new THREE.DirectionalLight( 0xfff5e8, 3.5 );
		keyLight.position.set( 3, 7, 5 );
		keyLight.castShadow = true;
		keyLight.shadow.mapSize.set( 2048, 2048 );
		keyLight.shadow.camera.near = 0.5;
		keyLight.shadow.camera.far  = 20;
		keyLight.shadow.camera.left   = -3;
		keyLight.shadow.camera.right  =  3;
		keyLight.shadow.camera.top    =  3;
		keyLight.shadow.camera.bottom = -3;
		keyLight.shadow.bias = -0.001;
		this._scene.add( keyLight );

		// Cool fill — opposite side, tinted blue-grey
		const fillLight = new THREE.DirectionalLight( 0x8ab4ff, 1.2 );
		fillLight.position.set( -5, 3, -3 );
		this._scene.add( fillLight );

		// Warm rim — from behind-right, gives depth edge
		const rimLight = new THREE.DirectionalLight( 0xffcc88, 1.8 );
		rimLight.position.set( 2, 4, -6 );
		this._scene.add( rimLight );

		// Subtle bounce — from below, simulates ground reflection
		const bounceLight = new THREE.DirectionalLight( 0xffffff, 0.3 );
		bounceLight.position.set( 0, -3, 2 );
		this._scene.add( bounceLight );

		// ── Ground ────────────────────────────────────────────────
		// Reflective disc that catches the shadow cleanly
		const groundGeo = new THREE.CircleGeometry( 2.2, 128 );
		const groundMat = new THREE.MeshStandardMaterial( {
			color:       0x1a1a2e,
			roughness:   0.6,
			metalness:   0.4,
			transparent: true,
			opacity:     0.85,
		} );
		const ground = new THREE.Mesh( groundGeo, groundMat );
		ground.rotation.x = - Math.PI / 2;
		ground.receiveShadow = true;
		ground.position.y = 0;
		this._scene.add( ground );

		// Soft glow ring under the vehicle
		const ringGeo = new THREE.RingGeometry( 0.85, 1.6, 128 );
		const ringMat = new THREE.MeshBasicMaterial( {
			color:       0x4a9eff,
			transparent: true,
			opacity:     0.12,
			side:        THREE.DoubleSide,
		} );
		const ring = new THREE.Mesh( ringGeo, ringMat );
		ring.rotation.x = - Math.PI / 2;
		ring.position.y = 0.002;
		this._scene.add( ring );
		this._glowRing = ring;

		// ── Camera ────────────────────────────────────────────────
		this._camera = new THREE.PerspectiveCamera( 32, w / h, 0.1, 100 );
		this._setCameraPos( 0 );

		// ── Resize ────────────────────────────────────────────────
		this._resizeObserver = new ResizeObserver( () => this._onResize() );
		this._resizeObserver.observe( this._container );

	}

	_setCameraPos( rotY ) {

		const x = CAM_DISTANCE * Math.cos( CAM_ELEVATION ) * Math.sin( CAM_AZIMUTH + rotY );
		const y = CAM_DISTANCE * Math.sin( CAM_ELEVATION );
		const z = CAM_DISTANCE * Math.cos( CAM_ELEVATION ) * Math.cos( CAM_AZIMUTH + rotY );
		this._camera.position.set( x, y + 0.35, z );
		this._camera.lookAt( 0, 0.35, 0 );

	}

	_loadModel( key ) {

		if ( this._vehicleGroup ) {

			this._scene.remove( this._vehicleGroup );
			this._vehicleGroup = null;

		}

		const loader = new GLTFLoader();
		loader.load( MODEL_PATH( key ), ( gltf ) => {

			if ( this._disposed ) return;

			const group = gltf.scene;
			group.scale.setScalar( 0.5 );

			// Compute bounding box and center the model exactly on y=0
			const box    = new THREE.Box3().setFromObject( group );
			const center = new THREE.Vector3();
			box.getCenter( center );
			const sizeY  = box.max.y - box.min.y;

			group.position.x = - center.x;
			group.position.y = - box.min.y * 0.5;   // sit on ground plane
			group.position.z = - center.z;

			// Improve material quality
			group.traverse( ( obj ) => {

				if ( ! obj.isMesh ) return;
				obj.castShadow    = true;
				obj.receiveShadow = true;

				if ( obj.material ) {

					obj.material.roughness = Math.min( obj.material.roughness ?? 0.8, 0.75 );
					obj.material.metalness = Math.max( obj.material.metalness ?? 0.0, 0.05 );
					obj.material.envMapIntensity = 1.2;

				}

			} );

			// Scale glow ring to vehicle footprint
			const footprint = Math.max( box.max.x - box.min.x, box.max.z - box.min.z ) * 0.5 * 0.8;
			this._glowRing.scale.setScalar( footprint );

			// Adjust camera distance based on model size
			const diag = Math.sqrt(
				Math.pow( box.max.x - box.min.x, 2 ) +
				Math.pow( sizeY, 2 ) +
				Math.pow( box.max.z - box.min.z, 2 )
			) * 0.5;
			const dist = Math.max( 2.4, diag * 3.2 );
			this._dynamicDist = dist;
			this._setCameraPosDynamic( this._rotY );

			this._vehicleGroup = group;
			this._scene.add( group );

			// Apply pending cosmetic loadout if set
			if ( this._pendingLoadout ) {

				applyCosmetics( group, this._pendingLoadout );

			}

			if ( this._raf === null ) this._startLoop();

		} );

	}

	/** Apply a cosmetic loadout to the preview model. Can be called before or after load. */
	applyLoadout( loadout ) {

		this._pendingLoadout = loadout;
		if ( this._vehicleGroup ) {

			stripCosmetics( this._vehicleGroup );
			applyCosmetics( this._vehicleGroup, loadout );

		}

	}

	_setCameraPosDynamic( rotY ) {

		const dist = this._dynamicDist || CAM_DISTANCE;
		const x = dist * Math.cos( CAM_ELEVATION ) * Math.sin( CAM_AZIMUTH + rotY );
		const y = dist * Math.sin( CAM_ELEVATION );
		const z = dist * Math.cos( CAM_ELEVATION ) * Math.cos( CAM_AZIMUTH + rotY );
		this._camera.position.set( x, y + 0.35, z );
		this._camera.lookAt( 0, 0.35, 0 );

	}

	_startLoop() {

		this._rotY       = 0;
		this._targetRotY = 0;

		const tick = () => {

			if ( this._disposed ) return;
			this._raf = requestAnimationFrame( tick );

			// Smooth auto-rotate
			this._targetRotY += 0.006;
			this._rotY += ( this._targetRotY - this._rotY ) * 0.08;

			if ( this._vehicleGroup ) {

				this._vehicleGroup.rotation.y = this._rotY;

			}

			// Subtle glow pulse
			if ( this._glowRing ) {

				this._glowRing.material.opacity = 0.10 + Math.sin( Date.now() * 0.002 ) * 0.04;

			}

			this._renderer.render( this._scene, this._camera );

		};

		tick();

	}

	setVehicle( key ) {

		if ( key === this._key ) return;
		this._key = key;

		// Fade-out trick: cancel loop, swap model, restart
		if ( this._raf !== null ) {

			cancelAnimationFrame( this._raf );
			this._raf = null;

		}

		this._loadModel( key );

	}

	_onResize() {

		const w = this._container.clientWidth;
		const h = this._container.clientHeight;
		if ( ! w || ! h ) return;
		this._camera.aspect = w / h;
		this._camera.updateProjectionMatrix();
		this._renderer.setSize( w, h );

	}

	dispose() {

		this._disposed = true;
		if ( this._raf !== null ) cancelAnimationFrame( this._raf );
		this._resizeObserver.disconnect();
		this._renderer.dispose();
		this._renderer.domElement.remove();

	}

}

export { VEHICLE_KEYS };
