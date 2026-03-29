// ─── Editor.js ────────────────────────────────────────────────────────────────
// Entry point for the track editor. Orchestrates all editor modules.

import { loadModels } from './EditorModels.js';
import { renderer, initResizeListener, startRenderLoop } from './EditorScene.js';
import { loadSaved, placeFinish } from './EditorCells.js';
import { undo, redo } from './EditorCells.js';
import { grid, history, redoStack } from './EditorState.js';
import { selectTool, initToolbarListeners, initSaveModal, initLoadModal } from './EditorUI.js';
import { initInputListeners } from './EditorInput.js';

export async function initEditor() {

	// Attach canvas to DOM
	document.body.appendChild( renderer.domElement );

	// Init resize handling
	initResizeListener();

	// Load GLB models
	await loadModels();

	// Restore last session or start blank
	loadSaved();
	if ( grid.size === 0 ) placeFinish();

	// Init undo/redo buttons
	document.getElementById( 'btn-undo' ).disabled = true;
	document.getElementById( 'btn-redo' ).disabled = true;
	document.getElementById( 'btn-undo' ).addEventListener( 'click', () => undo() );
	document.getElementById( 'btn-redo' ).addEventListener( 'click', () => redo() );

	// Init UI
	initToolbarListeners();
	initSaveModal();
	initLoadModal();

	// Init input (pass modal elements for Escape key handling)
	initInputListeners(
		selectTool,
		document.getElementById( 'modal-save' ),
		document.getElementById( 'modal-load' ),
	);

	// Start render loop
	startRenderLoop();

}
