import * as THREE from 'three';

// Max number of quad segments in the shared pool.
// Each segment = 4 vertices = 2 triangles.
const MAX_SEGMENTS = 400;
const SEGMENT_LIFETIME = 5.0;   // seconds before full fade-out
const FADE_IN_TIME    = 0.08;   // seconds to reach full opacity on spawn
const SKID_WIDTH      = 0.08;   // half-width of each tyre mark (metres)
const EMIT_THRESHOLD  = 0.25;   // driftIntensity required to leave marks
const MIN_MOVE_SQ     = 0.0001; // min squared distance between segments (avoids degenerate quads)
const Y_OFFSET        = 0.012;  // raise above road to avoid z-fighting

const _wp  = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _up   = new THREE.Vector3( 0, 1, 0 );

// ── Per-tyre emitter state ───────────────────────────────────────────────────

class TyreEmitter {

    constructor() {

        this.prevPos = new THREE.Vector3();
        this.hasPrev = false;

    }

    reset() { this.hasPrev = false; }

}

// ── Main class ───────────────────────────────────────────────────────────────

export class Skidmarks {

    constructor( scene ) {

        // Segment pool -------------------------------------------------------
        // Each slot stores: positions of 4 corners + alpha state.
        this._segments = [];
        for ( let i = 0; i < MAX_SEGMENTS; i++ ) {

            this._segments.push( {
                life: 0,       // remaining lifetime (0 = inactive)
                maxLife: SEGMENT_LIFETIME,
                fadeIn: 0,     // remaining fade-in time
            } );

        }
        this._nextSlot = 0;
        this._dirty = false;  // track whether buffers need GPU re-upload

        // BufferGeometry with dynamic buffers --------------------------------
        const geo = new THREE.BufferGeometry();

        // 4 vertices per segment
        this._positions = new Float32Array( MAX_SEGMENTS * 4 * 3 );
        this._alphas    = new Float32Array( MAX_SEGMENTS * 4 );     // per-vertex alpha

        // 2 triangles per segment (indices fixed forever)
        const indices = new Uint16Array( MAX_SEGMENTS * 6 );
        for ( let i = 0; i < MAX_SEGMENTS; i++ ) {

            const v = i * 4;
            const f = i * 6;
            indices[ f ]     = v;     indices[ f + 1 ] = v + 1; indices[ f + 2 ] = v + 2;
            indices[ f + 3 ] = v + 2; indices[ f + 4 ] = v + 1; indices[ f + 5 ] = v + 3;

        }

        geo.setIndex( new THREE.BufferAttribute( indices, 1 ) );
        geo.setAttribute( 'position', new THREE.BufferAttribute( this._positions, 3 ) );
        geo.setAttribute( 'alpha',    new THREE.BufferAttribute( this._alphas,    1 ) );

        geo.setDrawRange( 0, 0 ); // nothing visible until segments are written

        // Material -----------------------------------------------------------
        const mat = new THREE.MeshBasicMaterial( {
            color: 0x1a1a1a,
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits:  -1,
            side: THREE.DoubleSide,
        } );

        // Custom vertex-alpha via onBeforeCompile -------------------------
        // We inject a per-vertex 'alpha' attribute so each corner fades
        // independently as the segment ages.
        mat.onBeforeCompile = ( shader ) => {

            shader.vertexShader = 'attribute float alpha;\nvarying float vAlpha;\n'
                + shader.vertexShader.replace(
                    '#include <begin_vertex>',
                    'vAlpha = alpha;\n#include <begin_vertex>'
                );

            shader.fragmentShader = 'varying float vAlpha;\n'
                + shader.fragmentShader.replace(
                    'vec4 diffuseColor = vec4( diffuse, opacity );',
                    'vec4 diffuseColor = vec4( diffuse, opacity * vAlpha );'
                );

        };
        mat.needsUpdate = true;

        this._mesh = new THREE.Mesh( geo, mat );
        this._mesh.frustumCulled = false; // pool spans the whole track
        this._mesh.renderOrder = 1;
        scene.add( this._mesh );

        // Per-vehicle tyre emitters ------------------------------------------
        // Keyed by vehicle object reference (works for both Vehicle and RemoteVehicle).
        this._emitters = new Map(); // vehicle → { bl: TyreEmitter, br: TyreEmitter }

    }

    // ── Public API ───────────────────────────────────────────────────────────

    /**
     * Call once per frame per vehicle (local or remote).
     * vehicle must expose: driftIntensity, wheelBL, wheelBR, container.position
     */
    update( dt, vehicle ) {

        // Ensure per-vehicle emitter state exists
        let em = this._emitters.get( vehicle );
        if ( ! em ) {

            em = { bl: new TyreEmitter(), br: new TyreEmitter() };
            this._emitters.set( vehicle, em );

        }

        const shouldEmit = vehicle.driftIntensity > EMIT_THRESHOLD;

        if ( vehicle.wheelBL ) this._updateTyre( vehicle.wheelBL, vehicle, em.bl, shouldEmit );
        if ( vehicle.wheelBR ) this._updateTyre( vehicle.wheelBR, vehicle, em.br, shouldEmit );

        if ( ! shouldEmit ) {

            em.bl.reset();
            em.br.reset();

        }

        // Tick all active segments
        let maxActive = 0;
        let alphaChanged = false;
        for ( let i = 0; i < MAX_SEGMENTS; i++ ) {

            const seg = this._segments[ i ];
            if ( seg.life <= 0 ) continue;

            seg.life -= dt;
            if ( seg.life <= 0 ) {

                seg.life = 0;
                this._writeAlpha( i, 0 );
                alphaChanged = true;
                continue;

            }

            if ( seg.fadeIn > 0 ) seg.fadeIn = Math.max( 0, seg.fadeIn - dt );

            const fadeInT  = seg.fadeIn > 0 ? 1 - seg.fadeIn / FADE_IN_TIME : 1;
            const fadeOutT = Math.min( seg.life / ( SEGMENT_LIFETIME * 0.4 ), 1 );
            const alpha    = fadeInT * fadeOutT * 0.82;

            this._writeAlpha( i, alpha );
            alphaChanged = true;
            maxActive = i + 1;

        }

        const geo = this._mesh.geometry;
        if ( this._dirty ) {

            geo.attributes.position.needsUpdate = true;
            this._dirty = false;

        }
        if ( alphaChanged ) {

            geo.attributes.alpha.needsUpdate = true;

        }
        geo.setDrawRange( 0, maxActive * 6 );

    }

    /** Call when a vehicle is removed from the scene. */
    removeVehicle( vehicle ) {

        this._emitters.delete( vehicle );

    }

    dispose( scene ) {

        scene.remove( this._mesh );
        this._mesh.geometry.dispose();
        this._mesh.material.dispose();
        this._emitters.clear();

    }

    // ── Private ──────────────────────────────────────────────────────────────

    _updateTyre( wheel, vehicle, emitter, shouldEmit ) {

        wheel.getWorldPosition( _wp );
        _wp.y = vehicle.container.position.y + Y_OFFSET;

        if ( ! shouldEmit || ! emitter.hasPrev ) {

            emitter.prevPos.copy( _wp );
            emitter.hasPrev = shouldEmit;
            return;

        }

        _dir.subVectors( _wp, emitter.prevPos );
        const distSq = _dir.x * _dir.x + _dir.z * _dir.z;
        if ( distSq < MIN_MOVE_SQ ) return;

        _dir.y = 0;
        _dir.normalize();
        _perp.crossVectors( _dir, _up ).normalize().multiplyScalar( SKID_WIDTH );

        this._emitSegment( emitter.prevPos, _wp, _perp );
        this._dirty = true;
        emitter.prevPos.copy( _wp );

    }

    _emitSegment( from, to, perp ) {

        const i   = this._nextSlot;
        this._nextSlot = ( this._nextSlot + 1 ) % MAX_SEGMENTS;

        const seg   = this._segments[ i ];
        seg.life    = SEGMENT_LIFETIME;
        seg.maxLife = SEGMENT_LIFETIME;
        seg.fadeIn  = FADE_IN_TIME;

        // 4 corners: from-left, from-right, to-left, to-right
        const base = i * 4 * 3;
        const pos  = this._positions;

        pos[ base ]      = from.x - perp.x; pos[ base + 1 ]  = from.y; pos[ base + 2 ]  = from.z - perp.z;
        pos[ base + 3 ]  = from.x + perp.x; pos[ base + 4 ]  = from.y; pos[ base + 5 ]  = from.z + perp.z;
        pos[ base + 6 ]  = to.x   - perp.x; pos[ base + 7 ]  = to.y;   pos[ base + 8 ]  = to.z   - perp.z;
        pos[ base + 9 ]  = to.x   + perp.x; pos[ base + 10 ] = to.y;   pos[ base + 11 ] = to.z   + perp.z;

        this._writeAlpha( i, 0 );

    }

    _writeAlpha( segIdx, alpha ) {

        const base = segIdx * 4;
        this._alphas[ base ]     = alpha;
        this._alphas[ base + 1 ] = alpha;
        this._alphas[ base + 2 ] = alpha;
        this._alphas[ base + 3 ] = alpha;

    }

}
