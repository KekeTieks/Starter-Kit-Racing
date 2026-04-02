/**
 * CellFormat.js — canonical cell object format and serialization helpers.
 *
 * Canonical object shape:
 * {
 *   gx:          number,   // grid X
 *   gz:          number,   // grid Z
 *   type:        string,   // 'track-straight' | 'track-corner' | 'track-finish' | 'track-ramp'
 *   orient:      number,   // Godot GridMap index: 0 | 10 | 16 | 22
 *   isCheckpoint: boolean,
 *   isBump:      boolean,
 *   bumpOrient:  number,   // same domain as orient; only meaningful when isBump=true
 *   isTunnel:    boolean,  // adds tunnel ceiling overlay (mutually exclusive with track-ramp)
 *   rampLength:  number,   // 0.1–3.0, only meaningful when type='track-ramp'
 *   rampAngle:   number,   // 5–45 deg, only meaningful when type='track-ramp'
 *   rampWidth:   number,   // 0.1–2.0, only meaningful when type='track-ramp'
 * }
 *
 * Legacy positional array format (read-only for backward compat):
 *   Normal:  [gx, gz, type, orient, isCheckpoint?, isBump?, bumpOrient?]
 *   Ramp:    [gx, gz, 'track-ramp', orient, isCheckpoint, rampLength, rampAngle, rampWidth]
 */

/**
 * Parse any supported cell representation into the canonical object.
 * Accepts both the new object format and the old positional array format.
 */
export function parseCell( entry ) {

	// Already an object (new format)
	if ( ! Array.isArray( entry ) ) {

		return {
			gx:           entry.gx,
			gz:           entry.gz,
			type:         entry.type,
			orient:       entry.orient,
			isCheckpoint: entry.isCheckpoint ?? false,
			isBump:       entry.isBump       ?? false,
			bumpOrient:   entry.bumpOrient   ?? entry.orient,
			isTunnel:     entry.isTunnel     ?? false,
			rampLength:   entry.rampLength   ?? 1.0,
			rampAngle:    entry.rampAngle    ?? 15,
			rampWidth:    entry.rampWidth    ?? 1.0,
		};

	}

	// Legacy positional array format
	const [ gx, gz, type, orient ] = entry;

	if ( type === 'track-ramp' ) {

		return {
			gx,
			gz,
			type,
			orient,
			isCheckpoint: entry[ 4 ] === true,
			isBump:       false,
			bumpOrient:   orient,
			isTunnel:     false,
			rampLength:   entry[ 5 ] ?? 1.0,
			rampAngle:    entry[ 6 ] ?? 15,
			rampWidth:    entry[ 7 ] ?? 1.0,
		};

	}

	return {
		gx,
		gz,
		type,
		orient,
		isCheckpoint: entry[ 4 ] === true,
		isBump:       entry[ 5 ] === true,
		bumpOrient:   entry[ 6 ] !== undefined ? entry[ 6 ] : orient,
		isTunnel:     false,
		rampLength:   1.0,
		rampAngle:    15,
		rampWidth:    1.0,
	};

}

/**
 * Serialize a cell (from editor grid state) to the canonical object format.
 * The cell parameter is the editor's internal cell object:
 * { type, orient, isFinish, isCheckpoint, isBump, bumpOrient, rampLength, rampAngle, rampWidth }
 */
export function serializeCell( gx, gz, cell ) {

	const base = {
		gx,
		gz,
		type:         cell.type,
		orient:       cell.orient,
		isCheckpoint: cell.isCheckpoint ?? false,
		isBump:       cell.isBump       ?? false,
		bumpOrient:   cell.bumpOrient   ?? cell.orient,
		isTunnel:     cell.isTunnel     ?? false,
	};

	if ( cell.type === 'track-ramp' ) {

		base.rampLength = cell.rampLength ?? 1.0;
		base.rampAngle  = cell.rampAngle  ?? 15;
		base.rampWidth  = cell.rampWidth  ?? 1.0;

	}

	return base;

}
