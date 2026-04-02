// InputBuffer.js — Pre-allocated ring buffer for input history
// Used for client-side prediction reconciliation.
// Zero allocations after construction.

const CAPACITY = 256;

export class InputBuffer {

	constructor() {

		this._entries = [];
		for ( let i = 0; i < CAPACITY; i ++ ) {

			this._entries.push( { seq: 0, x: 0, z: 0, touchActive: false, handbrake: false, nitro: false, dt: 0, used: false } );

		}

		this._head = 0; // next write index
		this._count = 0;

	}

	push( seq, x, z, touchActive, handbrake, nitro, dt ) {

		const entry = this._entries[ this._head ];
		entry.seq = seq;
		entry.x = x;
		entry.z = z;
		entry.touchActive = touchActive;
		entry.handbrake = handbrake;
		entry.nitro = nitro;
		entry.dt = dt;
		entry.used = true;

		this._head = ( this._head + 1 ) % CAPACITY;
		if ( this._count < CAPACITY ) this._count ++;

	}

	// Discard all entries with seq <= ackSeq
	discardUpTo( ackSeq ) {

		// Mark entries as unused — they've been confirmed by the server
		for ( let i = 0; i < CAPACITY; i ++ ) {

			if ( this._entries[ i ].used && this._entries[ i ].seq <= ackSeq ) {

				this._entries[ i ].used = false;

			}

		}

	}

	// Count entries still pending (after ackSeq)
	countPending() {

		let count = 0;
		for ( let i = 0; i < CAPACITY; i ++ ) {

			if ( this._entries[ i ].used ) count ++;

		}

		return count;

	}

	// Iterate all pending entries in seq order (for replay)
	// Calls fn( entry ) for each. Does NOT allocate.
	forEachPending( fn ) {

		// Find the oldest entry (lowest seq among used)
		// Since entries are pushed in seq order and wrap, we iterate all and sort by seq
		// For performance, just scan all — CAPACITY is small (256)
		let minSeq = Infinity;
		let minIdx = - 1;

		for ( let i = 0; i < CAPACITY; i ++ ) {

			if ( this._entries[ i ].used && this._entries[ i ].seq < minSeq ) {

				minSeq = this._entries[ i ].seq;
				minIdx = i;

			}

		}

		if ( minIdx === - 1 ) return;

		// Iterate from minIdx forward through all used entries in insertion order
		let idx = minIdx;
		for ( let n = 0; n < CAPACITY; n ++ ) {

			if ( this._entries[ idx ].used ) {

				fn( this._entries[ idx ] );

			}

			idx = ( idx + 1 ) % CAPACITY;

		}

	}

	clear() {

		for ( let i = 0; i < CAPACITY; i ++ ) {

			this._entries[ i ].used = false;

		}

		this._head = 0;
		this._count = 0;

	}

}
