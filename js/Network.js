import { Client } from '@colyseus/sdk';

export class Network {

    constructor() {

        this.client = null;
        this.room = null;
        this.sessionId = null;
        this._joinedExistingRoom = false;

        // Server target state per player (latest from server)
        this.playerStates = new Map();
        this._knownPlayerIds = new Set();

        // Last sent input (avoid redundant sends)
        this._lastInputX = 0;
        this._lastInputZ = 0;
        this._lastTouchActive = false;
        this._inputIdleFrames = 0;

        // Callbacks
        this.onPlayerAdd = null;
        this.onPlayerRemove = null;
        this.onImpact = null;
        this.onDisconnect = null;
        this.onError = null;
        this.onPhaseChange = null;
        this.onPlayerFinished = null;

        this._lastPhase = '';
        this._lastCountdown = -1;

    }

    async connect( serverUrl, mapData, roomId ) {

        this.client = new Client( serverUrl );

        const options = {};
        if ( mapData ) options.map = mapData;

        if ( roomId ) {

            this.room = await this.client.joinById( roomId, options );
            this._joinedExistingRoom = true;

        } else {

            this.room = await this.client.joinOrCreate( 'race', options );
            this._joinedExistingRoom = false;

        }

        this.sessionId = this.room.sessionId;

        // Wait for first state sync
        await new Promise( ( resolve ) => {

            this.room.onStateChange.once( () => resolve() );

        } );

        // Process initial state
        this._syncPlayers();

        // Listen for ongoing state changes
        this.room.onStateChange( () => {

            this._syncPlayers();
            this._syncRaceState();

        } );

        // Messages
        this.room.onMessage( 'impact', ( data ) => {

            if ( this.onImpact ) this.onImpact( data.sessionId, data.velocity );

        } );

        this.room.onMessage( 'playerFinished', ( data ) => {

            if ( this.onPlayerFinished ) this.onPlayerFinished( data );

        } );

        this.room.onLeave( ( code ) => {

            if ( this.onDisconnect ) this.onDisconnect( code );

        } );

        this.room.onError( ( code, message ) => {

            if ( this.onError ) this.onError( code, message );

        } );

        return this.room;

    }

    _syncPlayers() {

        const state = this.room.state;
        if ( ! state || ! state.players ) return;

        const currentIds = new Set();

        state.players.forEach( ( player, sessionId ) => {

            currentIds.add( sessionId );

            let s = this.playerStates.get( sessionId );

            if ( ! s ) {

                // New player — store server target
                s = {
                    // Server target position (lerp toward this)
                    sx: player.x, sy: player.y, sz: player.z,
                    sqx: player.qx, sqy: player.qy, sqz: player.qz, sqw: player.qw,
                    // Gameplay values (used directly, no lerp needed)
                    linearSpeed: player.linearSpeed,
                    acceleration: player.acceleration,
                    driftIntensity: player.driftIntensity,
                    inputX: player.inputX,
                    inputZ: player.inputZ,
                    color: player.color,
                    currentLap: player.currentLap,
                    totalTime: player.totalTime,
                    lapTime: player.lapTime,
                    finished: player.finished,
                    finishPosition: player.finishPosition,
                    raceProgress: player.raceProgress,
                };
                this.playerStates.set( sessionId, s );

                if ( ! this._knownPlayerIds.has( sessionId ) ) {

                    this._knownPlayerIds.add( sessionId );
                    if ( this.onPlayerAdd ) this.onPlayerAdd( sessionId, player.color );

                }

            } else {

                // Update server target
                s.sx = player.x; s.sy = player.y; s.sz = player.z;
                s.sqx = player.qx; s.sqy = player.qy; s.sqz = player.qz; s.sqw = player.qw;
                s.linearSpeed = player.linearSpeed;
                s.acceleration = player.acceleration;
                s.driftIntensity = player.driftIntensity;
                s.inputX = player.inputX;
                s.inputZ = player.inputZ;
                s.color = player.color;
                s.currentLap = player.currentLap;
                s.totalTime = player.totalTime;
                s.lapTime = player.lapTime;
                s.finished = player.finished;
                s.finishPosition = player.finishPosition;
                s.raceProgress = player.raceProgress;

            }

        } );

        // Detect removed players
        for ( const id of this._knownPlayerIds ) {

            if ( ! currentIds.has( id ) ) {

                this._knownPlayerIds.delete( id );
                this.playerStates.delete( id );
                if ( this.onPlayerRemove ) this.onPlayerRemove( id );

            }

        }

    }

    _syncRaceState() {

        const state = this.room.state;
        if ( ! state ) return;

        const phase = state.phase;
        const countdown = state.countdown;

        if ( phase !== this._lastPhase || countdown !== this._lastCountdown ) {

            this._lastPhase = phase;
            this._lastCountdown = countdown;
            if ( this.onPhaseChange ) this.onPhaseChange( phase, countdown );

        }

    }

    sendInput( input ) {

        if ( ! this.room ) return;

        const x = input.x;
        const z = input.z;
        const touch = !! input.touchActive;

        const changed = x !== this._lastInputX || z !== this._lastInputZ || touch !== this._lastTouchActive;

        if ( changed ) {

            this._lastInputX = x;
            this._lastInputZ = z;
            this._lastTouchActive = touch;
            this._inputIdleFrames = 0;
            this.room.send( 'input', { x, z, touchActive: touch } );

        } else {

            this._inputIdleFrames++;
            if ( this._inputIdleFrames % 10 === 0 ) {

                this.room.send( 'input', { x, z, touchActive: touch } );

            }

        }

    }

    sendStartRace( mode, laps ) {

        if ( this.room ) {

            this.room.send( 'startRace', { mode, laps } );

        }

    }

    sendRestartRace() {

        if ( this.room ) {

            this.room.send( 'restartRace' );

        }

    }

    getMyState() {

        return this.playerStates.get( this.sessionId ) || null;

    }

    getPlayerState( sessionId ) {

        return this.playerStates.get( sessionId ) || null;

    }

    get roomId() {

        return this.room ? this.room.roomId : null;

    }

    get racePhase() {

        return this.room ? this.room.state.phase : 'waiting';

    }

    get raceMode() {

        return this.room ? this.room.state.mode : 'sandbox';

    }

    get countdown() {

        return this.room ? this.room.state.countdown : 0;

    }

    get totalLaps() {

        return this.room ? this.room.state.totalLaps : 3;

    }

    disconnect() {

        if ( this.room ) this.room.leave();
        this.room = null;

    }

}
