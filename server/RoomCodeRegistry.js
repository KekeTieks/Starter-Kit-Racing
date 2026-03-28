// Short room code registry — maps 4-letter codes to Colyseus roomIds.
// Kept in a separate module to avoid circular imports between index.js and RaceRoom.js.

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid visual confusion

function generateCode() {

    let code = '';
    for ( let i = 0; i < 4; i++ ) code += CHARS[ Math.floor( Math.random() * CHARS.length ) ];
    return code;

}

const roomCodes = new Map();   // code → roomId
const roomIdToCode = new Map(); // roomId → code

export function registerRoomCode( roomId ) {

    let code;
    let attempts = 0;
    do {

        code = generateCode();
        attempts++;

    } while ( roomCodes.has( code ) && attempts < 1000 );

    roomCodes.set( code, roomId );
    roomIdToCode.set( roomId, code );
    return code;

}

export function unregisterRoomCode( roomId ) {

    const code = roomIdToCode.get( roomId );
    if ( code ) {

        roomCodes.delete( code );
        roomIdToCode.delete( roomId );

    }

}

export function resolveRoomCode( code ) {

    return roomCodes.get( code.toUpperCase().trim() ) || null;

}
