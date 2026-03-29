// ─── EditorUI.js ──────────────────────────────────────────────────────────────
// Toolbar, toast, modal Save, modal Load, circuit validation UI.

import { saveCircuit, updateCircuit, loadCircuits, deleteCircuit, generateMinimap } from '../CircuitLibrary.js';
import { state } from './EditorState.js';
import { grid, cellKey } from './EditorState.js';
import { getCellsArray, save, clearAll, validateCircuit, placeFinish, loadSaved, placeRamp } from './EditorCells.js';
import { cpMarkerGeo, cpMarkerMat, placeMesh } from './EditorCells.js';
import { clearGhost } from './EditorGhost.js';
import * as THREE from 'three';
import { CELL_RAW } from '../Track.js';
import { trackGroup } from './EditorScene.js';

// ── Toast ─────────────────────────────────────────────────────────────────────

let toastTimer = 0;

export function showToast( msg ) {

	const el = document.getElementById( 'toast' );
	el.textContent = msg;
	el.classList.add( 'show' );
	clearTimeout( toastTimer );
	toastTimer = setTimeout( () => el.classList.remove( 'show' ), 2500 );

}

// ── Tool selection ─────────────────────────────────────────────────────────────

export function selectTool( t ) {

	state.tool = t;
	document.getElementById( 'btn-road' ).classList.toggle( 'active', t === 'road' );
	document.getElementById( 'btn-bump' ).classList.toggle( 'active', t === 'bump' );
	document.getElementById( 'btn-ramp' ).classList.toggle( 'active', t === 'ramp' );
	document.getElementById( 'btn-checkpoint' ).classList.toggle( 'active', t === 'checkpoint' );
	document.getElementById( 'btn-erase' ).classList.toggle( 'active', t === 'erase' );

	const rampPanel = document.getElementById( 'ramp-panel' );
	rampPanel.style.display = t === 'ramp' ? 'flex' : 'none';

}

// ── Toolbar listeners ─────────────────────────────────────────────────────────

export function initToolbarListeners() {

	document.getElementById( 'btn-road' ).addEventListener( 'click', () => selectTool( 'road' ) );
	document.getElementById( 'btn-bump' ).addEventListener( 'click', () => selectTool( 'bump' ) );
	document.getElementById( 'btn-ramp' ).addEventListener( 'click', () => selectTool( 'ramp' ) );
	document.getElementById( 'btn-checkpoint' ).addEventListener( 'click', () => selectTool( 'checkpoint' ) );
	document.getElementById( 'btn-erase' ).addEventListener( 'click', () => selectTool( 'erase' ) );

	// Ramp panel sliders
	const sliderLength = document.getElementById( 'ramp-length' );
	const sliderAngle  = document.getElementById( 'ramp-angle' );
	const sliderWidth  = document.getElementById( 'ramp-width' );

	function updateRampLabels() {
		document.getElementById( 'ramp-length-val' ).textContent = ( sliderLength.value / 10 ).toFixed( 1 );
		document.getElementById( 'ramp-angle-val' ).textContent  = sliderAngle.value + '°';
		document.getElementById( 'ramp-width-val' ).textContent  = Math.round( sliderWidth.value * 10 ) + '%';
	}

	sliderLength.addEventListener( 'input', updateRampLabels );
	sliderAngle.addEventListener( 'input', updateRampLabels );
	sliderWidth.addEventListener( 'input', updateRampLabels );
	updateRampLabels();

	document.getElementById( 'btn-play' ).addEventListener( 'click', async () => {

		const result = validateCircuit();
		if ( ! result.ok ) { showToast( result.msg ); return; }

		try {

			const res = await fetch( '/api/circuits', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { cells: getCellsArray() } ),
			} );

			if ( ! res.ok ) throw new Error( 'Server error' );
			const { id } = await res.json();
			window.open( 'index.html?circuit=' + id, '_blank' );

		} catch {

			showToast( 'Erreur serveur, impossible de lancer la piste.' );

		}

	} );

	document.getElementById( 'btn-share' ).addEventListener( 'click', async () => {

		if ( grid.size === 0 ) { showToast( 'Dessine une piste d\'abord !' ); return; }

		try {

			const res = await fetch( '/api/circuits', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { cells: getCellsArray() } ),
			} );

			if ( ! res.ok ) throw new Error( 'Server error' );
			const { id } = await res.json();
			const base = window.location.href.replace( /editor\.html.*/, '' );
			const url = base + 'index.html?circuit=' + id;
			navigator.clipboard.writeText( url )
				.then( () => showToast( 'Lien copié !' ) )
				.catch( () => showToast( url ) );

		} catch {

			showToast( 'Erreur serveur, impossible de partager.' );

		}

	} );

	document.getElementById( 'btn-clear' ).addEventListener( 'click', () => {

		clearAll( clearGhost );
		showToast( 'Piste effacée' );

	} );

}

export function getRampParams() {

	return {
		rampLength: parseFloat( document.getElementById( 'ramp-length' ).value ) / 10,
		rampAngle:  parseInt( document.getElementById( 'ramp-angle' ).value ),
		rampWidth:  parseInt( document.getElementById( 'ramp-width' ).value ) / 10,
	};

}

// ── Modal Save ────────────────────────────────────────────────────────────────

export function initSaveModal() {

	const modalSave = document.getElementById( 'modal-save' );
	const modalSaveName = document.getElementById( 'modal-save-name' );

	document.getElementById( 'btn-save-library' ).addEventListener( 'click', () => {

		if ( grid.size === 0 ) { showToast( 'Dessine une piste d\'abord !' ); return; }

		const updateRow = document.getElementById( 'modal-save-update-row' );
		const btnAsNew  = document.getElementById( 'modal-save-as-new' );
		const hasExisting = state.currentCircuitId !== null;

		if ( hasExisting ) {

			document.getElementById( 'modal-save-title' ).textContent = 'Mettre à jour le circuit';
			document.getElementById( 'modal-save-current-name' ).textContent = state.currentCircuitName;
			updateRow.style.display = 'block';
			modalSaveName.style.display = 'none';
			btnAsNew.style.display = 'inline-flex';
			document.getElementById( 'modal-save-confirm' ).textContent = 'Mettre à jour';

		} else {

			document.getElementById( 'modal-save-title' ).textContent = 'Sauvegarder le circuit';
			updateRow.style.display = 'none';
			modalSaveName.style.display = '';
			modalSaveName.value = 'Mon circuit';
			btnAsNew.style.display = 'none';
			document.getElementById( 'modal-save-confirm' ).textContent = 'Sauvegarder';

		}

		modalSave.classList.add( 'open' );
		setTimeout( () => {

			if ( hasExisting ) {

				document.getElementById( 'modal-save-confirm' ).focus();

			} else {

				modalSaveName.select();
				modalSaveName.focus();

			}

		}, 50 );

	} );

	function closeSaveModal() {

		modalSave.classList.remove( 'open' );

	}

	function confirmSave() {

		const cells = getCellsArray();

		if ( state.currentCircuitId !== null ) {

			updateCircuit( state.currentCircuitId, cells );
			showToast( `"${ state.currentCircuitName }" mis à jour !` );

		} else {

			const name = modalSaveName.value.trim();
			if ( ! name ) return;
			const newId = saveCircuit( name, cells );
			state.currentCircuitId = newId;
			state.currentCircuitName = name;
			showToast( `"${ name }" sauvegardé !` );

		}

		closeSaveModal();

	}

	function saveAsNew() {

		const updateRow = document.getElementById( 'modal-save-update-row' );
		const btnAsNew  = document.getElementById( 'modal-save-as-new' );
		document.getElementById( 'modal-save-title' ).textContent = 'Sauvegarder comme nouveau';
		updateRow.style.display = 'none';
		modalSaveName.style.display = '';
		modalSaveName.value = state.currentCircuitName ? state.currentCircuitName + ' (copie)' : 'Mon circuit';
		btnAsNew.style.display = 'none';
		document.getElementById( 'modal-save-confirm' ).textContent = 'Sauvegarder';

		document.getElementById( 'modal-save-confirm' ).onclick = () => {

			const name = modalSaveName.value.trim();
			if ( ! name ) return;
			const newId = saveCircuit( name, getCellsArray() );
			state.currentCircuitId = newId;
			state.currentCircuitName = name;
			showToast( `"${ name }" sauvegardé !` );
			closeSaveModal();
			document.getElementById( 'modal-save-confirm' ).onclick = null;

		};

		setTimeout( () => { modalSaveName.select(); modalSaveName.focus(); }, 10 );

	}

	document.getElementById( 'modal-save-confirm' ).addEventListener( 'click', confirmSave );
	document.getElementById( 'modal-save-as-new' ).addEventListener( 'click', saveAsNew );
	document.getElementById( 'modal-save-cancel' ).addEventListener( 'click', closeSaveModal );
	modalSave.addEventListener( 'click', ( e ) => { if ( e.target === modalSave ) closeSaveModal(); } );
	modalSaveName.addEventListener( 'keydown', ( e ) => {

		if ( e.key === 'Enter' ) confirmSave();
		if ( e.key === 'Escape' ) closeSaveModal();

	} );

}

// ── Modal Load ────────────────────────────────────────────────────────────────

export function initLoadModal() {

	const modalLoad = document.getElementById( 'modal-load' );

	function loadFromLibrary( cells, circuitId, circuitName ) {

		// Rebuild grid from cells array
		for ( const [ , cell ] of grid ) {

			if ( cell.mesh ) trackGroup.remove( cell.mesh );
			if ( cell.bumpMesh ) trackGroup.remove( cell.bumpMesh );
			if ( cell.cpMarker ) trackGroup.remove( cell.cpMarker );

		}

		grid.clear();

		for ( const entry of cells ) {

			const [ gx, gz, type, orient ] = entry;
			const isCheckpoint = entry[ 4 ] === true;
			const isBump = entry[ 5 ] === true;
			const bumpOrient = entry[ 6 ] !== undefined ? entry[ 6 ] : orient;
			const isFinish = ( type === 'track-finish' );
			const cell = { type, orient, isFinish, isCheckpoint, isBump, bumpOrient, mesh: null, bumpMesh: null, cpMarker: null };
			grid.set( cellKey( gx, gz ), cell );
			placeMesh( gx, gz, cell );

			if ( isCheckpoint ) {

				const marker = new THREE.Mesh( cpMarkerGeo, cpMarkerMat );
				marker.position.set( ( gx + 0.5 ) * CELL_RAW, 3.5, ( gz + 0.5 ) * CELL_RAW );
				trackGroup.add( marker );
				cell.cpMarker = marker;

			}

		}

		state.currentCircuitId = circuitId || null;
		state.currentCircuitName = circuitName || null;

		save();
		modalLoad.classList.remove( 'open' );
		showToast( 'Circuit chargé !' );

	}

	function openLoadModal() {

		const circuits = loadCircuits();
		const list = document.getElementById( 'modal-load-list' );
		list.innerHTML = '';

		if ( circuits.length === 0 ) {

			list.innerHTML = '<div class="library-empty">Aucun circuit sauvegardé</div>';

		} else {

			for ( const circ of circuits ) {

				const item = document.createElement( 'div' );
				item.className = 'library-item';

				const minimap = generateMinimap( circ.cells, 56 );
				const tag = circ.builtin ? 'Intégré' : 'Personnalisé';

				item.innerHTML = `
					<div class="lib-minimap">${ minimap }</div>
					<div class="lib-info">
						<div class="lib-name">${ circ.name }</div>
						<div class="lib-tag">${ tag }</div>
					</div>
					${ circ.builtin ? '' : `<button class="lib-delete" data-id="${ circ.id }" title="Supprimer">✕</button>` }
				`;

				const circId = circ.builtin ? null : circ.id;
				item.querySelector( '.lib-info' ).addEventListener( 'click', () => loadFromLibrary( circ.cells, circId, circ.name ) );
				item.querySelector( '.lib-minimap' ).addEventListener( 'click', () => loadFromLibrary( circ.cells, circId, circ.name ) );

				if ( ! circ.builtin ) {

					item.querySelector( '.lib-delete' ).addEventListener( 'click', ( e ) => {

						e.stopPropagation();
						deleteCircuit( circ.id );
						openLoadModal();

					} );

				}

				list.appendChild( item );

			}

		}

		modalLoad.classList.add( 'open' );

	}

	document.getElementById( 'btn-load-library' ).addEventListener( 'click', openLoadModal );
	document.getElementById( 'modal-load-cancel' ).addEventListener( 'click', () => modalLoad.classList.remove( 'open' ) );
	modalLoad.addEventListener( 'click', ( e ) => { if ( e.target === modalLoad ) modalLoad.classList.remove( 'open' ); } );

}
