import { Room } from 'colyseus';
import { updateWorld, rigidBody } from 'crashcat';
import { RaceState, PlayerState } from '../schema/RaceState.js';
import { initPhysics, createSphereBody } from '../simulation/PhysicsWorld.js';
import { VehicleSim } from '../simulation/VehicleSim.js';
import {
    DEFAULT_CELLS, decodeCells,
    computeSpawnPositions, computeSpawnPosition,
    computeFinishLine, computeCheckpoints
} from '../simulation/TrackData.js';

const COLORS = [ 'yellow', 'green', 'purple', 'red' ];
const TICK_RATE = 60;
const FINISH_TIMEOUT_MS = 60000; // 60s after first finisher
const INPUT_RATE_LIMIT = 120; // max input messages per second per client

export class RaceRoom extends Room {

    maxClients = 4;
    patchRate = 16; // ~60Hz state sync (default 50ms = 20Hz is too slow for racing)

    onCreate( options ) {

        this.state = new RaceState();

        const MAX_MAP_SIZE = 8192; // base64url: ~2730 cells, well above any reasonable track
        const rawMap = options.map || '';
        if ( typeof rawMap !== 'string' || rawMap.length > MAX_MAP_SIZE ) {

            throw new Error( 'Invalid map data' );

        }

        const mapData = rawMap;
        this.state.mapData = mapData;
        this.state.mode = 'sandbox';
        this.state.phase = 'waiting';

        this.trackCells = mapData ? decodeCells( mapData ) : DEFAULT_CELLS;
        this.world = initPhysics( this.trackCells );
        this.sims = new Map();
        this.colorIndex = 0;
        this.hostSessionId = null;

        // Race internals (not in schema)
        this.raceData = new Map();
        this.countdownRemaining = 0;
        this.raceStartTime = 0;
        this.finishLine = computeFinishLine( this.trackCells );
        this.checkpoints = computeCheckpoints( this.trackCells );
        this.finishTimeout = null;
        this.inputCounts = new Map(); // sessionId → { count, windowStart }

        // Contact listener for impact sounds
        this.contactListener = {
            onContactAdded: ( bodyA, bodyB ) => {

                for ( const [ sessionId, sim ] of this.sims ) {

                    if ( bodyA === sim.body || bodyB === sim.body ) {

                        const speed = Math.sqrt(
                            sim.modelVelX * sim.modelVelX + sim.modelVelZ * sim.modelVelZ
                        );

                        if ( speed > 2 ) {

                            this.broadcast( 'impact', { sessionId, velocity: speed } );

                        }

                        break;

                    }

                }

            }
        };

        // ─── Message handlers ─────────────────────────────

        this.onMessage( 'input', ( client, data ) => {

            if ( ! data || typeof data.x !== 'number' || typeof data.z !== 'number' ) return;
            if ( ! isFinite( data.x ) || ! isFinite( data.z ) ) return;

            // Rate limit: drop messages beyond INPUT_RATE_LIMIT per second
            const now = Date.now();
            let rc = this.inputCounts.get( client.sessionId );
            if ( ! rc ) {

                rc = { count: 0, windowStart: now };
                this.inputCounts.set( client.sessionId, rc );

            }

            if ( now - rc.windowStart >= 1000 ) {

                rc.count = 0;
                rc.windowStart = now;

            }

            rc.count++;
            if ( rc.count > INPUT_RATE_LIMIT ) return;

            const sim = this.sims.get( client.sessionId );
            if ( sim ) sim.setInput( {
                x: Math.max( -1, Math.min( 1, data.x ) ),
                z: Math.max( -1, Math.min( 1, data.z ) ),
                touchActive: !! data.touchActive,
            } );

        } );

        this.onMessage( 'startRace', ( client, data ) => {

            if ( this.state.phase !== 'waiting' ) return;
            if ( client.sessionId !== this.hostSessionId ) return;

            const mode = data && data.mode === 'sandbox' ? 'sandbox' : 'race';
            this.state.mode = mode;

            if ( mode === 'race' ) {

                this.state.totalLaps = Math.max( 1, Math.min( 10, parseInt( data.laps ) || 3 ) );
                this.startCountdown();

            } else {

                // Sandbox: free roam immediately
                this.state.phase = 'racing';

            }

        } );

        this.onMessage( 'restartRace', ( client ) => {

            if ( client.sessionId !== this.hostSessionId ) return;
            if ( this.state.phase !== 'finished' ) return;

            // Clear any pending finish timeout
            if ( this.finishTimeout ) {

                this.finishTimeout.clear();
                this.finishTimeout = null;

            }

            // Reset race fields
            this.state.phase = 'waiting';
            this.state.mode = 'sandbox';
            this.state.finishCount = 0;
            this.state.countdown = 0;
            this.state.raceTimer = 0;
            this.countdownRemaining = 0;

            // Reset all player race fields
            for ( const [ , player ] of this.state.players ) {

                player.currentLap = 0;
                player.lapTime = 0;
                player.totalTime = 0;
                player.finishPosition = 0;
                player.finished = false;
                player.raceProgress = 0;

            }

            // Unlock so new players can join
            this.unlock();

        } );

        // Fixed-rate simulation
        this.setSimulationInterval( ( deltaMs ) => this.tick( deltaMs ), 1000 / TICK_RATE );

    }

    // ─── Room lifecycle ───────────────────────────────────

    onJoin( client, options ) {

        // First player is the host
        if ( ! this.hostSessionId ) {

            this.hostSessionId = client.sessionId;

        }

        // Reject late joiners in race mode after countdown started
        if ( this.state.mode === 'race' && this.state.phase !== 'waiting' ) {

            client.leave();
            return;

        }

        const color = COLORS[ this.colorIndex % COLORS.length ];
        this.colorIndex++;

        const spawnPoints = computeSpawnPositions( this.trackCells, this.colorIndex );
        const spawn = spawnPoints[ spawnPoints.length - 1 ];

        const sim = new VehicleSim( this.world, spawn.position, spawn.angle );
        sim.body = createSphereBody( this.world, spawn.position );
        sim.spawnPos = [ ...spawn.position ];
        sim.spawnAngle = spawn.angle;
        this.sims.set( client.sessionId, sim );

        const player = new PlayerState();
        player.color = color;
        player.x = spawn.position[ 0 ];
        player.y = spawn.position[ 1 ];
        player.z = spawn.position[ 2 ];
        player.qw = sim.quat[ 3 ];
        player.qx = sim.quat[ 0 ];
        player.qy = sim.quat[ 1 ];
        player.qz = sim.quat[ 2 ];
        this.state.players.set( client.sessionId, player );

        console.log( `Player ${ client.sessionId } joined as ${ color }` );

    }

    onLeave( client ) {

        this.sims.delete( client.sessionId );
        this.raceData.delete( client.sessionId );
        this.inputCounts.delete( client.sessionId );
        this.state.players.delete( client.sessionId );

        // Transfer host if host left
        if ( client.sessionId === this.hostSessionId ) {

            const firstPlayer = this.sims.keys().next().value;
            this.hostSessionId = firstPlayer || null;

        }

        console.log( `Player ${ client.sessionId } left` );

    }

    // ─── Race flow ────────────────────────────────────────

    startCountdown() {

        // Clear any pending finish timeout from a previous race
        if ( this.finishTimeout ) {

            this.finishTimeout.clear();
            this.finishTimeout = null;

        }

        this.state.phase = 'countdown';
        this.state.countdown = 3;
        this.countdownRemaining = 3.0;
        this.state.finishCount = 0;

        // Lock room — no new players during race
        this.lock();

        // Initialize per-player race data and reset to spawn positions
        const spawnPoints = computeSpawnPositions( this.trackCells, this.sims.size );
        let i = 0;

        for ( const [ sessionId, sim ] of this.sims ) {

            const spawn = spawnPoints[ i ];
            i++;

            // Teleport to spawn
            rigidBody.setPosition( this.world, sim.body, spawn.position, false );
            rigidBody.setLinearVelocity( this.world, sim.body, [ 0, 0, 0 ] );
            rigidBody.setAngularVelocity( this.world, sim.body, [ 0, 0, 0 ] );

            sim.spherePos[ 0 ] = spawn.position[ 0 ];
            sim.spherePos[ 1 ] = spawn.position[ 1 ];
            sim.spherePos[ 2 ] = spawn.position[ 2 ];
            sim.linearSpeed = 0;
            sim.angularSpeed = 0;
            sim.acceleration = 0;
            sim.spawnPos = [ ...spawn.position ];
            sim.spawnAngle = spawn.angle;

            // Compute initial signed distance to finish line
            let prevDist = 0;
            if ( this.finishLine ) {

                prevDist = ( spawn.position[ 0 ] - this.finishLine.cx ) * this.finishLine.nx +
                    ( spawn.position[ 2 ] - this.finishLine.cz ) * this.finishLine.nz;

            }

            this.raceData.set( sessionId, {
                prevSignedDist: prevDist,
                checkpointsPassed: new Set(),
                lapStartTime: 0,
                lapTimes: [],
            } );

            // Reset player race fields
            const player = this.state.players.get( sessionId );
            if ( player ) {

                player.currentLap = 0;
                player.lapTime = 0;
                player.totalTime = 0;
                player.finishPosition = 0;
                player.finished = false;

            }

        }

    }

    // ─── Simulation tick ──────────────────────────────────

    tick( deltaMs ) {

        const dt = deltaMs / 1000;
        const isFrozen = this.state.mode === 'race' &&
            ( this.state.phase === 'countdown' || this.state.phase === 'finished' );

        // ── Countdown timer ───────────────────────────────
        if ( this.state.phase === 'countdown' ) {

            this.countdownRemaining -= dt;
            this.state.countdown = Math.max( 0, Math.ceil( this.countdownRemaining ) );

            if ( this.countdownRemaining <= 0 ) {

                this.state.phase = 'racing';
                this.state.countdown = 0;
                this.raceStartTime = Date.now();

                // Set lap start times
                for ( const [ , rd ] of this.raceData ) {

                    rd.lapStartTime = this.raceStartTime;

                }

            }

        }

        // ── Phase 1: inputs ───────────────────────────────
        for ( const [ , sim ] of this.sims ) {

            if ( isFrozen ) {

                sim.inputX = 0;
                sim.inputZ = 0;
                sim.linearSpeed = 0;
                sim.angularSpeed = 0;

                if ( sim.body ) {

                    rigidBody.setAngularVelocity( this.world, sim.body, [ 0, 0, 0 ] );
                    rigidBody.setLinearVelocity( this.world, sim.body, [ 0, 0, 0 ] );

                }

            } else {

                sim.applyInput( dt );

            }

        }

        // ── Phase 2: physics step ─────────────────────────
        updateWorld( this.world, this.contactListener, dt );

        // ── Phase 3: read back + sync to schema ───────────
        for ( const [ sessionId, sim ] of this.sims ) {

            sim.readBack( dt );

            const player = this.state.players.get( sessionId );
            if ( ! player ) continue;

            player.x = sim.spherePos[ 0 ];
            player.y = sim.spherePos[ 1 ];
            player.z = sim.spherePos[ 2 ];
            player.qx = sim.quat[ 0 ];
            player.qy = sim.quat[ 1 ];
            player.qz = sim.quat[ 2 ];
            player.qw = sim.quat[ 3 ];
            player.linearSpeed = sim.linearSpeed;
            player.acceleration = sim.acceleration;
            player.driftIntensity = sim.driftIntensity;
            player.inputX = sim.inputX;
            player.inputZ = sim.inputZ;

        }

        // ── Phase 4: race logic (lap detection) ───────────
        if ( this.state.mode === 'race' && this.state.phase === 'racing' && this.finishLine ) {

            const now = Date.now();
            this.state.raceTimer = now - this.raceStartTime;

            for ( const [ sessionId, sim ] of this.sims ) {

                const player = this.state.players.get( sessionId );
                const rd = this.raceData.get( sessionId );
                if ( ! player || ! rd || player.finished ) continue;

                // Update timers
                player.totalTime = now - this.raceStartTime;
                player.lapTime = now - rd.lapStartTime;

                const px = sim.spherePos[ 0 ];
                const pz = sim.spherePos[ 2 ];

                // Check checkpoints (proximity)
                for ( let ci = 0; ci < this.checkpoints.length; ci++ ) {

                    if ( rd.checkpointsPassed.has( ci ) ) continue;

                    const cp = this.checkpoints[ ci ];
                    const cpDist = Math.hypot( px - cp.cx, pz - cp.cz );
                    if ( cpDist < cp.radius ) {

                        rd.checkpointsPassed.add( ci );

                    }

                }

                const allCheckpointsPassed = rd.checkpointsPassed.size >= this.checkpoints.length;

                // Check finish line crossing (plane test)
                const signedDist =
                    ( px - this.finishLine.cx ) * this.finishLine.nx +
                    ( pz - this.finishLine.cz ) * this.finishLine.nz;

                if ( rd.prevSignedDist < 0 && signedDist >= 0 && allCheckpointsPassed ) {

                    // Lateral bounds check
                    const lateralDist = Math.abs(
                        ( px - this.finishLine.cx ) * ( -this.finishLine.nz ) +
                        ( pz - this.finishLine.cz ) * this.finishLine.nx
                    );

                    if ( lateralDist < this.finishLine.halfWidth ) {

                        // Valid lap!
                        rd.lapTimes.push( now - rd.lapStartTime );
                        rd.lapStartTime = now;
                        rd.checkpointsPassed.clear();
                        player.currentLap++;

                        if ( player.currentLap >= this.state.totalLaps ) {

                            player.finished = true;
                            this.state.finishCount++;
                            player.finishPosition = this.state.finishCount;
                            player.totalTime = now - this.raceStartTime;

                            this.broadcast( 'playerFinished', {
                                sessionId,
                                position: player.finishPosition,
                                totalTime: player.totalTime,
                            } );

                            // All finished?
                            if ( this.state.finishCount >= this.state.players.size ) {

                                this.state.phase = 'finished';

                            } else if ( this.state.finishCount === 1 ) {

                                // Start timeout for remaining players
                                this.finishTimeout = this.clock.setTimeout( () => {

                                    this.state.phase = 'finished';

                                }, FINISH_TIMEOUT_MS );

                            }

                        }

                    }

                }

                rd.prevSignedDist = signedDist;

                // Update live race progress for real-time leaderboard ranking.
                // Progress = currentLap + fraction (0..1) of current lap completed.
                // We split the lap in two halves at the checkpoint:
                //   [0.0 .. 0.5) = before checkpoint (signedDist goes from ~0 to max negative then back up)
                //   [0.5 .. 1.0) = after checkpoint, approaching finish line (signedDist goes negative → 0)
                // We use a normalised signed distance: positive means "just crossed / ahead",
                // negative means "heading away from finish". We clamp to [-1, 1] using a scale
                // proportional to the track size so the fraction is meaningful across map sizes.
                if ( ! player.finished ) {

                    const SCALE = this.finishLine.halfWidth * 8; // rough half-track-length estimate
                    const normDist = Math.max( -1, Math.min( 1, signedDist / SCALE ) );
                    let lapFraction;

                    if ( ! allCheckpointsPassed ) {
                        // First half: leaving finish line, heading to checkpoint.
                        // normDist starts near 0 (just crossed) and goes negative as they go away.
                        // Map [-1..0] → [0.5..0] so further away = more progress.
                        lapFraction = 0.25 - normDist * 0.25; // 0 at start, 0.5 when fully away
                    } else {
                        // Second half: past checkpoint, heading back to finish line.
                        // normDist goes from very negative back up to 0 (crossing).
                        // Map [-1..0] → [0.5..1] so approaching finish = more progress.
                        lapFraction = 0.75 - normDist * 0.25; // 0.5 when far, approaches 1 at finish
                    }

                    player.raceProgress = player.currentLap + lapFraction;

                }

            }

        }

    }

    onDispose() {

        if ( this.finishTimeout ) this.finishTimeout.clear();
        console.log( 'RaceRoom disposed' );

    }

}
