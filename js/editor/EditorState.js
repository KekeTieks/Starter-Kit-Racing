// ─── EditorState.js ───────────────────────────────────────────────────────────
// Shared mutable state for the track editor.
// All editor modules import from here — no circular deps since this imports nothing.

export const grid = new Map(); // "gx,gz" → { type, orient, isFinish, isCheckpoint, isBump, mesh, cpMarker }

export const state = {
	tool: 'road',             // 'road' | 'bump' | 'checkpoint' | 'erase'
	currentCircuitId: null,   // id of the loaded circuit (null = new)
	currentCircuitName: null, // name of the loaded circuit
};

export const history = [];
export const redoStack = [];
export const MAX_HISTORY = 50;

export function cellKey( gx, gz ) { return gx + ',' + gz; }
