import path from 'path';
import { fileURLToPath } from 'url';
import { defineServer, defineRoom } from 'colyseus';
import express from 'express';
import { RaceRoom } from './rooms/RaceRoom.js';
import { resolveRoomCode } from './RoomCodeRegistry.js';
import { migrate } from './db/migrate.js';
import authRouter    from './routes/auth.js';
import profileRouter from './routes/profile.js';
import upgradesRouter from './routes/upgrades.js';
import cosmeticsRouter from './routes/cosmetics.js';

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );
const port = parseInt( process.env.PORT || '2567' );

const publicDir = process.env.NODE_ENV === 'production'
    ? path.resolve( __dirname, '..', 'dist' )
    : path.resolve( __dirname, '..' );

// ── Run DB migrations before starting the server ──────────────────────────────
await migrate();

// ─────────────────────────────────────────────────────────────────────────────

const server = defineServer( {

    rooms: {
        race: defineRoom( RaceRoom ),
    },

    express: ( app ) => {

        app.use( express.json() );

        // ── Auth ────────────────────────────────────────────────────────────
        app.use( '/api/auth',     authRouter );
        app.use( '/api/profile',  profileRouter );
        app.use( '/api/upgrades', upgradesRouter );
        app.use( '/api/cosmetics', cosmeticsRouter );

        // ── Room code resolution ─────────────────────────────────────────────
        app.get( '/api/room-code/:code', ( req, res ) => {

            const code = req.params.code.toUpperCase().trim();
            const roomId = resolveRoomCode( code );

            if ( roomId ) {

                res.json( { roomId } );

            } else {

                res.status( 404 ).json( { error: 'Room not found' } );

            }

        } );

        // ── Static client files ──────────────────────────────────────────────
        app.use( express.static( publicDir, {
            extensions: [ 'html' ],
        } ) );

    },

} );

server.listen( port ).then( () => {

    console.log( `Racing server listening on http://localhost:${ port }` );

} );
