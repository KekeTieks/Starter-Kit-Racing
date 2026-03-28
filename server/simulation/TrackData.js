// Track codec adapted from Track.js for Node.js (no Three.js / no btoa/atob)

export const ORIENT_DEG = { 0: 0, 10: 180, 16: 90, 22: 270 };
export const CELL_RAW = 9.99;
export const GRID_SCALE = 0.75;

const TYPE_NAMES = [ 'track-straight', 'track-corner', 'track-bump', 'track-finish' ];
const TYPE_INDEX = {};
for ( let i = 0; i < TYPE_NAMES.length; i++ ) TYPE_INDEX[ TYPE_NAMES[ i ] ] = i;

const ORIENT_TO_GODOT = [ 0, 16, 10, 22 ];
const GODOT_TO_ORIENT = { 0: 0, 16: 1, 10: 2, 22: 3 };

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

export function decodeCells( str ) {

    const bytes = Buffer.from( str.replace( /-/g, '+' ).replace( /_/g, '/' ), 'base64' );
    const cells = [];

    for ( let i = 0; i + 2 < bytes.length; i += 3 ) {

        const gx = bytes[ i ] - 128;
        const gz = bytes[ i + 1 ] - 128;
        const packed = bytes[ i + 2 ];
        const ti = ( packed >> 2 ) & 0x03;
        const oi = packed & 0x03;
        const cp = ( packed >> 4 ) & 0x01;

        const cell = [ gx, gz, TYPE_NAMES[ ti ], ORIENT_TO_GODOT[ oi ] ];
        if ( cp ) cell.push( true );
        cells.push( cell );

    }

    return cells;

}

export function computeSpawnPosition( cells ) {

    let cell = cells[ 0 ];

    for ( const c of cells ) {

        if ( c[ 2 ] === 'track-finish' ) {

            cell = c;
            break;

        }

    }

    if ( ! cell ) return { position: [ 3.5, 0.5, 5 ], angle: 0 };

    const gx = cell[ 0 ];
    const gz = cell[ 1 ];
    const x = ( gx + 0.5 ) * CELL_RAW * GRID_SCALE;
    const z = ( gz + 0.5 ) * CELL_RAW * GRID_SCALE;

    const orient = cell[ 3 ];
    const deg = ORIENT_DEG[ orient ] || 0;
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

    const finishCell = cells.find( c => c[ 2 ] === 'track-finish' );
    if ( ! finishCell ) return null;

    const [ gx, gz, , orient ] = finishCell;
    const deg = ORIENT_DEG[ orient ] || 0;
    const rad = deg * Math.PI / 180;

    const cx = ( gx + 0.5 ) * CELL_RAW * GRID_SCALE;
    const cz = ( gz + 0.5 ) * CELL_RAW * GRID_SCALE;

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

    // Use manually placed checkpoints if any exist (cell[4] === true)
    const manual = cells.filter( c => c[ 4 ] === true );

    if ( manual.length > 0 ) {

        return manual.map( c => ( {
            cx: ( c[ 0 ] + 0.5 ) * CELL_RAW * GRID_SCALE,
            cz: ( c[ 1 ] + 0.5 ) * CELL_RAW * GRID_SCALE,
            radius: CELL_RAW * GRID_SCALE * 0.6,
        } ) );

    }

    // Fallback: pick the cell farthest from finish
    const finishCell = cells.find( c => c[ 2 ] === 'track-finish' );
    if ( ! finishCell ) return [];

    let maxDist = 0;
    let cpCell = cells[ 0 ];

    for ( const cell of cells ) {

        const d = Math.abs( cell[ 0 ] - finishCell[ 0 ] ) + Math.abs( cell[ 1 ] - finishCell[ 1 ] );
        if ( d > maxDist ) {

            maxDist = d;
            cpCell = cell;

        }

    }

    return [ {
        cx: ( cpCell[ 0 ] + 0.5 ) * CELL_RAW * GRID_SCALE,
        cz: ( cpCell[ 1 ] + 0.5 ) * CELL_RAW * GRID_SCALE,
        radius: CELL_RAW * GRID_SCALE * 0.6,
    } ];

}
