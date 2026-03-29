import { Room } from 'colyseus';
import { updateWorld, rigidBody, ContactValidateResult } from 'crashcat';
import { RaceState, PlayerState } from '../schema/RaceState.js';
import { initPhysics, createSphereBody, createChassisBody, initRayFilter } from '../simulation/PhysicsWorld.js';
import { VehicleSim } from '../simulation/VehicleSim.js';
import { VEHICLE_STATS, USE_ARCADE_VEHICLE } from '../simulation/VehicleStats.js';
import {
    DEFAULT_CELLS, decodeCells,
    computeSpawnPositions, computeSpawnPosition,
    computeFinishLine, computeCheckpoints
} from '../simulation/TrackData.js';
import { registerRoomCode, unregisterRoomCode } from '../RoomCodeRegistry.js';
import { query } from '../db/client.js';
import { computeRaceRewards, computeLevel, xpForLevel } from '../db/xp.js';
import { UPGRADE_CONFIG, MAX_UPGRADE_LEVEL } from '../simulation/UpgradeConfig.js';

/**
 * Applies player upgrade levels to a (already deep-cloned) stats object.
 * rawUpgrades: { engine: 2, brakes: 1 } — level integers sent by client.
 * Deltas are recomputed server-side from UPGRADE_CONFIG; client values are never trusted.
 */
function applyUpgrades( stats, rawUpgrades ) {

    if ( ! rawUpgrades || typeof rawUpgrades !== 'object' || Array.isArray( rawUpgrades ) ) return;

    for ( const def of UPGRADE_CONFIG ) {

        const level = Math.min(
            Math.floor( rawUpgrades[ def.id ] ?? 0 ),
            MAX_UPGRADE_LEVEL,
            def.levels.length
        );

        for ( let i = 0; i < level; i++ ) {

            for ( const [ stat, val ] of Object.entries( def.levels[ i ].delta ) ) {

                if ( typeof stats[ stat ] === 'number' ) stats[ stat ] += val;

            }

        }

    }

}

const COLORS = [ 'yellow', 'green', 'purple', 'red' ];
const TICK_RATE = 60;
const FINISH_TIMEOUT_MS = 60000; // 60s after first finisher
const INPUT_RATE_LIMIT = 120; // max input messages per second per client

export class RaceRoom extends Room {

    maxClients = 4;
    patchRate = 16; // ~60Hz state sync (default 50ms = 20Hz is too slow for racing)
    autoDispose = true; // dispose room when last player leaves (prevents zombie rooms)

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

        // Register a short room code for this room
        this.roomCode = registerRoomCode( this.roomId );
        this.state.roomCode = this.roomCode;
        console.log( `Room ${ this.roomId } registered with code ${ this.roomCode }` );

        // Weather: fixed for the entire race, chosen at room creation
        const WEATHER_OPTIONS = [ 'clear', 'clear', 'clear', 'rain', 'fog', 'storm' ];
        this.state.weather = options.weather || WEATHER_OPTIONS[ Math.floor( Math.random() * WEATHER_OPTIONS.length ) ];
        console.log( `Room ${ this.roomId } weather: ${ this.state.weather }` );

        this.trackCells = mapData ? decodeCells( mapData ) : DEFAULT_CELLS;
        this.world = initPhysics( this.trackCells );
        this._rayFilter = USE_ARCADE_VEHICLE ? initRayFilter( this.world ) : null;
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
        this.inputCounts  = new Map(); // sessionId → { count, windowStart }
        this.playerStats  = new Map(); // sessionId → upgraded stats object

        // Contact listener — let crashcat's solver handle collision response
        // natively. We only use the callback to broadcast impact events and
        // tune restitution/friction via the settings object.
        // NEVER call setLinearVelocity / setAngularVelocity inside callbacks —
        // that fights the constraint solver and produces ghost 180s.
        const wallBodies = this.world._wallBodies || new Set();

        this.contactListener = {
            onContactValidate: ( bodyA, bodyB, _baseOffset, hit ) => {

                for ( const [ , sim ] of this.sims ) {

                    if ( bodyA === sim.body || bodyB === sim.body ) {

                        const otherBody = bodyA === sim.body ? bodyB : bodyA;

                        if ( ! wallBodies.has( otherBody ) ) break;

                        // Reject contacts whose penetration axis is mostly vertical —
                        // ghost contacts at arc seam joints produce normals with a large
                        // Y component; real wall contacts are nearly horizontal.
                        const ax = hit.penetrationAxis;
                        const len2 = ax[ 0 ] * ax[ 0 ] + ax[ 1 ] * ax[ 1 ] + ax[ 2 ] * ax[ 2 ];

                        if ( len2 > 0.0001 && ( ax[ 1 ] * ax[ 1 ] / len2 ) > 0.5 ) {

                            return ContactValidateResult.REJECT_CONTACT;

                        }

                        break;

                    }

                }

                return ContactValidateResult.ACCEPT_ALL_CONTACTS_FOR_THIS_BODY_PAIR;

            },
            onContactAdded: ( bodyA, bodyB, _manifold, settings ) => {

                for ( const [ sessionId, sim ] of this.sims ) {

                    if ( bodyA === sim.body || bodyB === sim.body ) {

                        const otherBody = bodyA === sim.body ? bodyB : bodyA;
                        if ( ! wallBodies.has( otherBody ) ) break;

                        const vel = sim.body.motionProperties.linearVelocity;
                        const speed = Math.sqrt( vel[ 0 ] * vel[ 0 ] + vel[ 2 ] * vel[ 2 ] );

                        if ( speed > 2 ) {

                            this.broadcast( 'impact', { sessionId, velocity: speed } );

                        }

                        settings.combinedRestitution = 0.0;
                        settings.combinedFriction = 0.85;

                        break;

                    }

                }

            },
            onContactPersisted: ( bodyA, bodyB, _manifold, settings ) => {

                for ( const [ , sim ] of this.sims ) {

                    if ( bodyA === sim.body || bodyB === sim.body ) {

                        const otherBody = bodyA === sim.body ? bodyB : bodyA;
                        if ( ! wallBodies.has( otherBody ) ) break;

                        settings.combinedRestitution = 0.0;
                        settings.combinedFriction = 0.85;

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
                handbrake: !! data.handbrake,
                nitro: !! data.nitro,
            } );

        } );

        this.onMessage( 'startRace', ( client, data ) => {

            if ( this.state.phase !== 'waiting' ) return;
            if ( client.sessionId !== this.hostSessionId ) return;

            // Apply weather choice: specific type or 'random'
            const VALID_WEATHERS = [ 'clear', 'rain', 'fog', 'storm', 'night' ];
            const WEATHER_OPTIONS = [ 'clear', 'clear', 'clear', 'rain', 'fog', 'storm' ];
            if ( data && data.weather && VALID_WEATHERS.includes( data.weather ) ) {

                this.state.weather = data.weather;

            } else {

                // 'random' or missing — pick a new random weather
                this.state.weather = WEATHER_OPTIONS[ Math.floor( Math.random() * WEATHER_OPTIONS.length ) ];

            }

            // Propagate updated weather to all active sims
            for ( const sim of this.sims.values() ) {

                sim.weatherType = this.state.weather;

            }

            console.log( `Room ${ this.roomId } weather at startRace: ${ this.state.weather }` );

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

        this.onMessage( 'setMap', ( client, data ) => {

            if ( client.sessionId !== this.hostSessionId ) return;
            if ( this.state.phase !== 'waiting' ) return;

            const MAX_MAP_SIZE = 8192;
            if ( typeof data !== 'string' || data.length > MAX_MAP_SIZE ) return;

            // Rebuild track and physics world with new map
            this.state.mapData = data;
            this.trackCells = data ? decodeCells( data ) : DEFAULT_CELLS;
            this.world = initPhysics( this.trackCells );
            this._rayFilter = USE_ARCADE_VEHICLE ? initRayFilter( this.world ) : null;
            this.finishLine = computeFinishLine( this.trackCells );
            this.checkpoints = computeCheckpoints( this.trackCells );

            // Recreate all vehicle bodies in new world and reset to new spawn positions
            const spawnPoints = computeSpawnPositions( this.trackCells, this.sims.size );
            let i = 0;
            for ( const [ sessionId, sim ] of this.sims ) {

                const spawn = spawnPoints[ i++ ];
                const simStats = this.playerStats.get( sessionId )
                    || VEHICLE_STATS[ this.state.players.get( sessionId )?.vehicle || 'yellow' ];
                sim.body = USE_ARCADE_VEHICLE
                    ? createChassisBody( this.world, spawn.position, simStats )
                    : createSphereBody( this.world, spawn.position );
                if ( this._rayFilter ) sim._rayFilter = this._rayFilter;
                sim.spawnPos = [ ...spawn.position ];
                sim.spawnAngle = spawn.angle;
                sim.spherePos[ 0 ] = spawn.position[ 0 ];
                sim.spherePos[ 1 ] = spawn.position[ 1 ];
                sim.spherePos[ 2 ] = spawn.position[ 2 ];
                sim.linearSpeed = 0;
                sim.angularSpeed = 0;

                const player = this.state.players.get( sessionId );
                if ( player ) {

                    player.x = spawn.position[ 0 ];
                    player.y = spawn.position[ 1 ];
                    player.z = spawn.position[ 2 ];

                }

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

        // Read identity from join options (set by client Network.connect)
        const username = ( options && typeof options.username === 'string' )
            ? options.username.slice( 0, 20 ) : '';
        const requestedVehicle = ( options && VEHICLE_STATS[ options.vehicle ] )
            ? options.vehicle : null;

        // Use the requested vehicle color if not already taken, otherwise fallback to next free color
        const usedColors = new Set();
        for ( const [ , p ] of this.state.players ) usedColors.add( p.color );
        const vehicleKey = ( requestedVehicle && ! usedColors.has( requestedVehicle ) )
            ? requestedVehicle
            : COLORS.find( ( c ) => ! usedColors.has( c ) ) || COLORS[ this.colorIndex % COLORS.length ];
        this.colorIndex++;

        const color = vehicleKey;
        const stats = JSON.parse( JSON.stringify( VEHICLE_STATS[ vehicleKey ] ) );

        const rawUpgrades = ( options && typeof options.upgrades === 'object' && ! Array.isArray( options.upgrades ) )
            ? options.upgrades : {};
        applyUpgrades( stats, rawUpgrades );
        this.playerStats.set( client.sessionId, stats );

        const spawnPoints = computeSpawnPositions( this.trackCells, this.colorIndex );
        const spawn = spawnPoints[ spawnPoints.length - 1 ];

        const sim = new VehicleSim( this.world, spawn.position, spawn.angle, stats );
        sim.body = USE_ARCADE_VEHICLE
            ? createChassisBody( this.world, spawn.position, stats )
            : createSphereBody( this.world, spawn.position );
        if ( this._rayFilter ) sim._rayFilter = this._rayFilter;
        sim.spawnPos = [ ...spawn.position ];
        sim.spawnAngle = spawn.angle;
        sim.weatherType = this.state.weather;
        this.sims.set( client.sessionId, sim );

        const player = new PlayerState();
        player.color = color;
        player.username = username;
        player.vehicle = vehicleKey;
        player.x = spawn.position[ 0 ];
        player.y = spawn.position[ 1 ];
        player.z = spawn.position[ 2 ];
        player.qw = sim.quat[ 3 ];
        player.qx = sim.quat[ 0 ];
        player.qy = sim.quat[ 1 ];
        player.qz = sim.quat[ 2 ];
        this.state.players.set( client.sessionId, player );

        console.log( `Player ${ client.sessionId } (${ username || 'anonymous' }) joined as ${ color } ${ vehicleKey }` );

    }

    onLeave( client ) {

        const sim = this.sims.get( client.sessionId );
        if ( sim?.body ) rigidBody.remove( this.world, sim.body );

        this.sims.delete( client.sessionId );
        this.raceData.delete( client.sessionId );
        this.inputCounts.delete( client.sessionId );
        this.playerStats.delete( client.sessionId );
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

            // Reset quaternion to spawn angle
            const sa = spawn.angle || 0;
            const spawnQuat = [ 0, Math.sin( sa / 2 ), 0, Math.cos( sa / 2 ) ];
            rigidBody.setQuaternion( this.world, sim.body, spawnQuat, false );
            sim.quat = [ ...spawnQuat ];

            sim.spherePos[ 0 ] = spawn.position[ 0 ];
            sim.spherePos[ 1 ] = spawn.position[ 1 ];
            sim.spherePos[ 2 ] = spawn.position[ 2 ];
            sim.linearSpeed = 0;
            sim.angularSpeed = 0;
            sim.acceleration = 0;
            sim.spawnPos = [ ...spawn.position ];
            sim.spawnAngle = spawn.angle;

            if ( sim._arcadeVehicle ) sim._arcadeVehicle.reset();

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
            const lv = sim.body ? sim.body.motionProperties.linearVelocity : null;
            if ( lv ) { player.vx = lv[ 0 ]; player.vy = lv[ 1 ]; player.vz = lv[ 2 ]; }
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

                                this._endRace();

                            } else if ( this.state.finishCount === 1 ) {

                                // Start timeout for remaining players
                                this.finishTimeout = this.clock.setTimeout( () => {

                                    this._endRace();

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

    // ─── End race ─────────────────────────────────────────────────────────────

    _endRace() {

        this.state.phase = 'finished';
        const playersCount = this.state.players.size;

        // Award XP & credits to every player asynchronously (don't block the room)
        for ( const [ sessionId, player ] of this.state.players ) {

            const rank = player.finished ? player.finishPosition : 0;
            this._awardRaceResult( sessionId, player.username, rank, playersCount ).catch( ( err ) => {

                console.error( `[RaceRoom] award error for ${ player.username }:`, err.message );

            } );

        }

    }

    async _awardRaceResult( sessionId, username, rank, playersCount ) {

        if ( ! username ) return;

        // Fetch player
        const { rows } = await query(
            `SELECT p.id, s.level, s.xp, s.xp_this_level, s.credits, s.races_played, s.wins
             FROM players p
             JOIN player_stats s ON s.player_id = p.id
             WHERE p.username = $1`,
            [ username ]
        );

        if ( rows.length === 0 ) return; // player not registered yet — skip

        const s = rows[ 0 ];
        const { xp: xpEarned, credits: creditsEarned } = computeRaceRewards( rank, playersCount );
        const { level: newLevel, xp_this_level: newXpThisLevel } = computeLevel(
            s.level, s.xp_this_level, xpEarned
        );

        await query(
            `UPDATE player_stats SET
                level         = $1,
                xp            = xp + $2,
                xp_this_level = $3,
                credits       = credits + $4,
                races_played  = races_played + 1,
                wins          = wins + $5,
                updated_at    = NOW()
             WHERE player_id  = $6`,
            [ newLevel, xpEarned, newXpThisLevel, creditsEarned, rank === 1 ? 1 : 0, s.id ]
        );

        await query(
            `INSERT INTO race_results (player_id, rank, players_count, xp_earned, credits_earned)
             VALUES ($1, $2, $3, $4, $5)`,
            [ s.id, rank, playersCount, xpEarned, creditsEarned ]
        );

        console.log( `[RaceRoom] ${ username } awarded ${ xpEarned } XP / ${ creditsEarned } credits (rank ${ rank }/${ playersCount })` );

        // Send rewards to the client so they can update their local profile without a re-fetch
        const client = this.clients.getById( sessionId );
        if ( client ) {
            client.send( 'raceReward', {
                xp_earned:     xpEarned,
                credits_earned: creditsEarned,
                xp:            s.xp + xpEarned,
                xp_this_level: newXpThisLevel,
                xp_for_next:   xpForLevel( newLevel + 1 ),
                credits:       Number( s.credits ) + creditsEarned,
                new_level:     newLevel,
            } );
        }

    }

    onDispose() {

        if ( this.finishTimeout ) this.finishTimeout.clear();
        unregisterRoomCode( this.roomId );
        console.log( 'RaceRoom disposed' );

    }

}
