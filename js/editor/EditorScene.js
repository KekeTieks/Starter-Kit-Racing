// ─── EditorScene.js ───────────────────────────────────────────────────────────
// Three.js renderer, scene, lights, ground, grid helper, track/ghost groups, camera.

import * as THREE from 'three';
import { CELL_RAW, GRID_SCALE } from '../Track.js';

export const cellWorld = CELL_RAW * GRID_SCALE;

// ── Renderer ──────────────────────────────────────────────────────────────────

export const renderer = new THREE.WebGLRenderer( { antialias: true } );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.setPixelRatio( window.devicePixelRatio );
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// ── Scene ─────────────────────────────────────────────────────────────────────

export const scene = new THREE.Scene();
scene.background = new THREE.Color( 0xadb2ba );
scene.fog = new THREE.Fog( 0xadb2ba, 80, 160 );

const dirLight = new THREE.DirectionalLight( 0xffffff, 5 );
dirLight.position.set( 11.4, 15, - 5.3 );
dirLight.castShadow = true;
dirLight.shadow.mapSize.setScalar( 4096 );
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 100;
dirLight.shadow.camera.left = - 60;
dirLight.shadow.camera.right = 60;
dirLight.shadow.camera.top = 60;
dirLight.shadow.camera.bottom = - 60;
scene.add( dirLight );

const hemiLight = new THREE.HemisphereLight( 0xc8d8e8, 0x7a8a5a, 1.5 );
scene.add( hemiLight );

const groundMat = new THREE.MeshStandardMaterial( { color: 0x369069, metalness: 0 } );
const ground = new THREE.Mesh( new THREE.PlaneGeometry( 200, 200 ), groundMat );
ground.rotation.x = - Math.PI / 2;
ground.position.y = - 0.14;
ground.receiveShadow = true;
scene.add( ground );

const gridSize = 30;
const gridHelper = new THREE.GridHelper( gridSize * cellWorld, gridSize, 0x4a7a2a, 0x4a7a2a );
gridHelper.position.y = - 0.49;
gridHelper.material.opacity = 0.3;
gridHelper.material.transparent = true;
scene.add( gridHelper );

// Track group (mirrors game structure: y=-0.5, scaled by GRID_SCALE)
export const trackGroup = new THREE.Group();
trackGroup.position.y = - 0.5;
trackGroup.scale.setScalar( GRID_SCALE );
scene.add( trackGroup );

// Ghost preview group
export const ghostGroup = new THREE.Group();
ghostGroup.position.y = - 0.5;
ghostGroup.scale.setScalar( GRID_SCALE );
scene.add( ghostGroup );

// ── Camera (orthographic top-down) ────────────────────────────────────────────

export const frustum = 30;
const cellCenter = 0.5 * CELL_RAW * GRID_SCALE;

export const camera = new THREE.OrthographicCamera(
	- frustum * ( window.innerWidth / window.innerHeight ),
	frustum * ( window.innerWidth / window.innerHeight ),
	frustum, - frustum,
	0.1, 200
);
camera.position.set( cellCenter, 50, cellCenter );
camera.lookAt( cellCenter, 0, cellCenter );

export const camTarget = new THREE.Vector3( cellCenter, 0, cellCenter );

// ── Resize ────────────────────────────────────────────────────────────────────

export function initResizeListener() {

	window.addEventListener( 'resize', () => {

		const a = window.innerWidth / window.innerHeight;
		camera.left = - frustum * a;
		camera.right = frustum * a;
		camera.updateProjectionMatrix();
		renderer.setSize( window.innerWidth, window.innerHeight );

	} );

}

// ── Render loop ───────────────────────────────────────────────────────────────

export function startRenderLoop() {

	function animate() {

		requestAnimationFrame( animate );
		renderer.render( scene, camera );

	}

	animate();

}
