import path from 'path';
import { fileURLToPath } from 'url';
import { defineServer, defineRoom } from 'colyseus';
import express from 'express';
import { RaceRoom } from './rooms/RaceRoom.js';

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );
const publicDir = path.resolve( __dirname, '..' );
const port = parseInt( process.env.PORT || '2567' );

const server = defineServer( {

    rooms: {
        race: defineRoom( RaceRoom ),
    },

    express: ( app ) => {

        // Serve static client files from parent directory
        app.use( express.static( publicDir, {
            extensions: [ 'html' ],
        } ) );

    },

} );

server.listen( port ).then( () => {

    console.log( `Racing server listening on http://localhost:${ port }` );

} );
