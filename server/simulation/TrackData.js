// Track data utilities for Node.js (no Three.js dependency)

import { parseCell } from '../../shared/CellFormat.js';
export { ORIENT_DEG, CELL_RAW, GRID_SCALE } from '../../shared/TrackConstants.js';
import { ORIENT_DEG, CELL_RAW, GRID_SCALE } from '../../shared/TrackConstants.js';

export const DEFAULT_CELLS = [
    [ -3, -3, 'track-corner',   16 ],
    [ -2, -3, 'track-straight', 22 ],
    [ -1, -3, 'track-straight', 22 ],
    [  0, -3, 'track-corner',    0 ],
    [ -3, -2, 'track-straight',  0 ],
    [  0, -2, 'track-straight',  0 ],
    [ -3, -1, 'track-corner',   10 ],
    [ -2, -1, 'track-corner',    0 ],
    [  0, -1, 'track-straight',  0 ],
    [ -2,  0, 'track-straight', 10 ],
    [  0,  0, 'track-finish',    0 ],
    [ -2,  1, 'track-straight', 10 ],
    [  0,  1, 'track-straight',  0 ],
    [ -2,  2, 'track-corner',   10 ],
    [ -1,  2, 'track-straight', 16 ],
    [  0,  2, 'track-corner',   22 ],
];

export function computeSpawnPosition( cells ) {

    let found = null;

    for ( const entry of cells ) {

        const c = parseCell( entry );
        if ( c.type === 'track-finish' ) { found = c; break; }

    }

    if ( ! found ) found = parseCell( cells[ 0 ] );
    if ( ! found ) return { position: [ 3.5, 0.5, 5 ], angle: 0 };

    const x = ( found.gx + 0.5 ) * CELL_RAW * GRID_SCALE;
    const z = ( found.gz + 0.5 ) * CELL_RAW * GRID_SCALE;
    const deg = ORIENT_DEG[ found.orient ] || 0;
    const angle = deg * Math.PI / 180;

    return { position: [ x, 0.5, z ], angle };

}

export function computeSpawnPositions( cells, count ) {

    const base = computeSpawnPosition( cells );
    const positions = [];

    // Spread players side by side on the finish line
    const angle = base.angle;
    const rightX = Math.cos( angle );
    const rightZ = -Math.sin( angle );
    const spacing = 2.5;

    for ( let i = 0; i < count; i++ ) {

        const offset = ( i - ( count - 1 ) / 2 ) * spacing;
        positions.push( {
            position: [
                base.position[ 0 ] + rightX * offset,
                base.position[ 1 ],
                base.position[ 2 ] + rightZ * offset,
            ],
            angle: base.angle,
        } );

    }

    return positions;

}

// ─── Finish line & checkpoint geometry ────────────────────

export function computeFinishLine( cells ) {

    let finishCell = null;

    for ( const entry of cells ) {

        const c = parseCell( entry );
        if ( c.type === 'track-finish' ) { finishCell = c; break; }

    }

    if ( ! finishCell ) return null;

    const deg = ORIENT_DEG[ finishCell.orient ] || 0;
    const rad = deg * Math.PI / 180;

    const cx = ( finishCell.gx + 0.5 ) * CELL_RAW * GRID_SCALE;
    const cz = ( finishCell.gz + 0.5 ) * CELL_RAW * GRID_SCALE;

    return {
        cx, cz,
        // Forward normal (valid crossing direction)
        nx: Math.sin( rad ),
        nz: Math.cos( rad ),
        // Half-width for lateral bounds check
        halfWidth: CELL_RAW * GRID_SCALE * 0.5,
    };

}

export function computeCheckpoints( cells ) {

    // Use manually placed checkpoints if any (isCheckpoint === true)
    const parsed = cells.map( parseCell );
    const manual = parsed.filter( c => c.isCheckpoint );

    if ( manual.length > 0 ) {

        return manual.map( c => ( {
            cx: ( c.gx + 0.5 ) * CELL_RAW * GRID_SCALE,
            cz: ( c.gz + 0.5 ) * CELL_RAW * GRID_SCALE,
            radius: CELL_RAW * GRID_SCALE * 0.6,
        } ) );

    }

    // Fallback: pick the cell farthest from finish
    const finishCell = parsed.find( c => c.type === 'track-finish' );
    if ( ! finishCell ) return [];

    let maxDist = 0;
    let cpCell = parsed[ 0 ];

    for ( const cell of parsed ) {

        const d = Math.abs( cell.gx - finishCell.gx ) + Math.abs( cell.gz - finishCell.gz );
        if ( d > maxDist ) {

            maxDist = d;
            cpCell = cell;

        }

    }

    return [ {
        cx: ( cpCell.gx + 0.5 ) * CELL_RAW * GRID_SCALE,
        cz: ( cpCell.gz + 0.5 ) * CELL_RAW * GRID_SCALE,
        radius: CELL_RAW * GRID_SCALE * 0.6,
    } ];

}
