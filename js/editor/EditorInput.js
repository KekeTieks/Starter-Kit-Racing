// ─── EditorInput.js ───────────────────────────────────────────────────────────
// Pointer events (draw, pan, pinch/zoom), keyboard shortcuts, raycasting.

import * as THREE from 'three';
import { state } from './EditorState.js';
import { renderer, camera, camTarget, frustum, cellWorld } from './EditorScene.js';
import { placeRoad, placeBump, placeRamp, toggleCheckpoint, eraseRoad } from './EditorCells.js';
import { updateGhost, clearGhost } from './EditorGhost.js';
import { undo, redo } from './EditorCells.js';
import { getRampParams } from './EditorUI.js';

// ── Raycasting ────────────────────────────────────────────────────────────────

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function screenToGrid( clientX, clientY ) {

	mouse.x = ( clientX / window.innerWidth ) * 2 - 1;
	mouse.y = - ( clientY / window.innerHeight ) * 2 + 1;

	raycaster.setFromCamera( mouse, camera );

	const plane = new THREE.Plane( new THREE.Vector3( 0, 1, 0 ), 0.51 );
	const hit = new THREE.Vector3();
	raycaster.ray.intersectPlane( plane, hit );

	if ( ! hit ) return null;

	return {
		gx: Math.floor( hit.x / cellWorld ),
		gz: Math.floor( hit.z / cellWorld ),
	};

}

// ── Input state ───────────────────────────────────────────────────────────────

let isPanning = false;
let isDrawing = false;
let isErasing = false;
let panStart = { x: 0, y: 0 };
let camStart = { x: 0, z: 0 };
let lastDrawCell = null;
let spaceDown = false;

const pointers = new Map();
let pinchStartDist = 0;
let pinchStartZoom = 1;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getPinchDist() {

	const pts = [ ...pointers.values() ];
	const dx = pts[ 1 ].x - pts[ 0 ].x;
	const dy = pts[ 1 ].y - pts[ 0 ].y;
	return Math.sqrt( dx * dx + dy * dy );

}

function getPinchMid() {

	const pts = [ ...pointers.values() ];
	return {
		x: ( pts[ 0 ].x + pts[ 1 ].x ) / 2,
		y: ( pts[ 0 ].y + pts[ 1 ].y ) / 2,
	};

}

function handleDraw( clientX, clientY ) {

	const cell = screenToGrid( clientX, clientY );
	if ( ! cell ) return;

	if ( lastDrawCell && lastDrawCell.gx === cell.gx && lastDrawCell.gz === cell.gz ) return;
	lastDrawCell = cell;

	if ( isErasing ) {

		eraseRoad( cell.gx, cell.gz, clearGhost );

	} else if ( isDrawing ) {

		if ( state.tool === 'checkpoint' ) {

			toggleCheckpoint( cell.gx, cell.gz );

		} else if ( state.tool === 'bump' ) {

			placeBump( cell.gx, cell.gz );

		} else if ( state.tool === 'ramp' ) {

			const p = getRampParams();
			placeRamp( cell.gx, cell.gz, p.rampLength, p.rampAngle, p.rampWidth );

		} else {

			placeRoad( cell.gx, cell.gz );

		}

	}

}

// ── Event listeners ───────────────────────────────────────────────────────────

export function initInputListeners( selectToolFn, modalSaveEl, modalLoadEl ) {

	const el = renderer.domElement;

	el.addEventListener( 'contextmenu', ( e ) => e.preventDefault() );

	el.addEventListener( 'pointerdown', ( e ) => {

		el.setPointerCapture( e.pointerId );
		pointers.set( e.pointerId, { x: e.clientX, y: e.clientY } );

		if ( pointers.size === 2 ) {

			isDrawing = false;
			isErasing = false;
			isPanning = true;
			const mid = getPinchMid();
			panStart.x = mid.x;
			panStart.y = mid.y;
			camStart.x = camTarget.x;
			camStart.z = camTarget.z;
			pinchStartDist = getPinchDist();
			pinchStartZoom = camera.zoom;
			return;

		}

		if ( pointers.size > 2 ) return;

		if ( e.button === 1 || ( e.button === 0 && ( e.ctrlKey || e.metaKey || spaceDown ) ) ) {

			isPanning = true;
			panStart.x = e.clientX;
			panStart.y = e.clientY;
			camStart.x = camTarget.x;
			camStart.z = camTarget.z;
			el.style.cursor = 'grabbing';
			return;

		}

		if ( e.button === 0 ) {

			if ( state.tool === 'erase' ) {

				isErasing = true;

			} else {

				isDrawing = true;

			}

			lastDrawCell = null;
			if ( e.pointerType !== 'touch' ) handleDraw( e.clientX, e.clientY );

		} else if ( e.button === 2 ) {

			isErasing = true;
			lastDrawCell = null;
			handleDraw( e.clientX, e.clientY );

		}

	} );

	el.addEventListener( 'pointermove', ( e ) => {

		pointers.set( e.pointerId, { x: e.clientX, y: e.clientY } );

		if ( pointers.size === 2 && isPanning ) {

			const mid = getPinchMid();
			const scale = frustum * 2 / window.innerHeight / camera.zoom;
			camTarget.x = camStart.x - ( mid.x - panStart.x ) * scale;
			camTarget.z = camStart.z - ( mid.y - panStart.y ) * scale;
			camera.position.x = camTarget.x;
			camera.position.z = camTarget.z;
			camera.lookAt( camTarget.x, 0, camTarget.z );
			const dist = getPinchDist();
			camera.zoom = Math.max( 0.1, Math.min( 10, pinchStartZoom * ( dist / pinchStartDist ) ) );
			camera.updateProjectionMatrix();
			return;

		}

		if ( isPanning ) {

			const zoom = camera.zoom;
			const dx = ( e.clientX - panStart.x ) / window.innerWidth * frustum * 2 * ( window.innerWidth / window.innerHeight ) / zoom;
			const dz = ( e.clientY - panStart.y ) / window.innerHeight * frustum * 2 / zoom;
			camTarget.x = camStart.x - dx;
			camTarget.z = camStart.z - dz;
			camera.position.x = camTarget.x;
			camera.position.z = camTarget.z;
			camera.lookAt( camTarget.x, 0, camTarget.z );
			return;

		}

		if ( isDrawing || isErasing ) {

			handleDraw( e.clientX, e.clientY );
			return;

		}

		if ( e.pointerType === 'mouse' ) {

			const cell = screenToGrid( e.clientX, e.clientY );
			if ( cell ) {

				updateGhost( cell.gx, cell.gz );

			} else {

				clearGhost();

			}

		}

	} );

	window.addEventListener( 'pointerup', ( e ) => {

		pointers.delete( e.pointerId );

		if ( pointers.size === 0 ) {

			if ( ( isDrawing || isErasing ) && lastDrawCell === null && ! isPanning ) {

				handleDraw( e.clientX, e.clientY );

			}

			isPanning = false;
			isDrawing = false;
			isErasing = false;
			lastDrawCell = null;
			el.style.cursor = spaceDown ? 'grab' : '';

		}

	} );

	window.addEventListener( 'pointercancel', ( e ) => {

		pointers.delete( e.pointerId );

	} );

	el.addEventListener( 'wheel', ( e ) => {

		e.preventDefault();

		if ( e.ctrlKey ) {

			const zoomSpeed = 1.02;
			camera.zoom *= e.deltaY > 0 ? 1 / zoomSpeed : zoomSpeed;
			camera.zoom = Math.max( 0.1, Math.min( 10, camera.zoom ) );
			camera.updateProjectionMatrix();

		} else {

			const scale = frustum * 2 / window.innerHeight / camera.zoom;
			camTarget.x += e.deltaX * scale;
			camTarget.z += e.deltaY * scale;
			camera.position.x = camTarget.x;
			camera.position.z = camTarget.z;
			camera.lookAt( camTarget.x, 0, camTarget.z );

		}

	}, { passive: false } );

	window.addEventListener( 'keydown', ( e ) => {

		if ( e.target.tagName === 'INPUT' ) return;

		if ( e.key === ' ' ) {

			if ( ! spaceDown ) { spaceDown = true; el.style.cursor = 'grab'; }
			e.preventDefault();

		} else if ( ( e.key === 'z' || e.key === 'Z' ) && ( e.ctrlKey || e.metaKey ) && ! e.shiftKey ) {

			undo(); e.preventDefault();

		} else if (
			( ( e.key === 'y' || e.key === 'Y' ) && ( e.ctrlKey || e.metaKey ) ) ||
			( ( e.key === 'z' || e.key === 'Z' ) && ( e.ctrlKey || e.metaKey ) && e.shiftKey )
		) {

			redo(); e.preventDefault();

		} else if ( e.key === '1' ) { selectToolFn( 'road' );
		} else if ( e.key === '2' ) { selectToolFn( 'bump' );
		} else if ( e.key === '3' ) { selectToolFn( 'checkpoint' );
		} else if ( e.key === '4' ) { selectToolFn( 'erase' );
		} else if ( e.key === 'Escape' ) {

			if ( modalSaveEl ) modalSaveEl.classList.remove( 'open' );
			if ( modalLoadEl ) modalLoadEl.classList.remove( 'open' );

		}

	} );

	window.addEventListener( 'keyup', ( e ) => {

		if ( e.key === ' ' ) {

			spaceDown = false;
			if ( ! isPanning ) el.style.cursor = '';

		}

	} );

}
