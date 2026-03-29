import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { createWorldSettings, createWorld, addBroadphaseLayer, addObjectLayer, enableCollision, registerAll, updateWorld, rigidBody, box, MotionType } from 'crashcat';
import { Vehicle } from './Vehicle.js';
import { RemoteVehicle } from './RemoteVehicle.js';
import { Camera } from './Camera.js';
import { Controls } from './Controls.js';
import { buildTrack, encodeCells, decodeCells, computeSpawnPosition, computeTrackBounds } from './Track.js';
import { buildWallColliders, createSphereBody, createChassisBody, createKinematicSphereBody, initRayFilter } from './Physics.js';
import { SmokeTrails } from './Particles.js';
import { GameAudio } from './Audio.js';
import { Network } from './Network.js';
import { Lobby } from './Lobby.js';
import { RaceHUD } from './RaceHUD.js';
import { VEHICLE_STATS, USE_ARCADE_VEHICLE } from './VehicleStats.js';
import { upgradeService } from './UpgradeService.js';
import { profileService } from './ProfileService.js';


const renderer = new THREE.WebGLRenderer( { antialias: true, outputBufferType: THREE.HalfFloatType } );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.setPixelRatio( window.devicePixelRatio );
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const bloomPass = new UnrealBloomPass( new THREE.Vector2( window.innerWidth, window.innerHeight ) );
bloomPass.strength = 0.02;
bloomPass.radius = 0.02;
bloomPass.threshold = 0.5;

renderer.setEffects( [ bloomPass ] );

document.body.appendChild( renderer.domElement );
renderer.domElement.classList.add( 'hidden' ); // hidden until a race starts

const scene = new THREE.Scene();
scene.background = new THREE.Color( 0xadb2ba );
scene.fog = new THREE.Fog( 0xadb2ba, 30, 55 );

const dirLight = new THREE.DirectionalLight( 0xffffff, 5 );
dirLight.position.set( 11.4, 15, -5.3 );
dirLight.castShadow = true;
dirLight.shadow.mapSize.setScalar( 4096 );
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 60;
scene.add( dirLight );

const hemiLight = new THREE.HemisphereLight( 0xc8d8e8, 0x7a8a5a, 1.5 );
scene.add( hemiLight );


window.addEventListener( 'resize', () => {

	renderer.setSize( window.innerWidth, window.innerHeight );

} );

const loader = new GLTFLoader();
const modelNames = [
	'vehicle-truck-yellow', 'vehicle-truck-green', 'vehicle-truck-purple', 'vehicle-truck-red',
	'track-straight', 'track-corner', 'track-bump', 'track-finish',
	'decoration-empty', 'decoration-forest', 'decoration-tents',
];

const COLOR_TO_MODEL = {
	yellow: 'vehicle-truck-yellow',
	green: 'vehicle-truck-green',
	purple: 'vehicle-truck-purple',
	red: 'vehicle-truck-red',
};

const models = {};

async function loadModels() {

	const promises = modelNames.map( ( name ) =>
		new Promise( ( resolve, reject ) => {

			loader.load( `models/${ name }.glb`, ( gltf ) => {

				gltf.scene.traverse( ( child ) => {

					if ( child.isMesh ) {

						child.material.side = THREE.FrontSide;

					}

				} );

				// Godot imports vehicle models at root_scale=0.5
				if ( name.startsWith( 'vehicle-' ) ) {

					gltf.scene.scale.setScalar( 0.5 );

				}

				models[ name ] = gltf.scene;
				resolve();

			}, undefined, reject );

		} )
	);

	await Promise.all( promises );

}

// ─── Shared setup ────────────────────────────────────────

function setupScene( customCells ) {

	const bounds = computeTrackBounds( customCells );
	const hw = bounds.halfWidth;
	const hd = bounds.halfDepth;
	const groundSize = Math.max( hw, hd ) * 2 + 20;

	const shadowExtent = Math.max( hw, hd ) + 10;
	dirLight.shadow.camera.left = - shadowExtent;
	dirLight.shadow.camera.right = shadowExtent;
	dirLight.shadow.camera.top = shadowExtent;
	dirLight.shadow.camera.bottom = - shadowExtent;
	dirLight.shadow.camera.updateProjectionMatrix();

	scene.fog.near = groundSize * 0.4;
	scene.fog.far = groundSize * 0.8;

	const trackObjects = buildTrack( scene, models, customCells );

	return { bounds, trackObjects };

}

// ─── Single-player ────────────────────────────────────────

function initSinglePlayer( customCells, spawn, vehicleKey ) {

	renderer.domElement.classList.remove( 'hidden' );

	const { bounds } = setupScene( customCells );
	const groundSize = Math.max( bounds.halfWidth, bounds.halfDepth ) * 2 + 20;

	registerAll();

	const worldSettings = createWorldSettings();
	worldSettings.gravity = [ 0, - 9.81, 0 ];

	const BPL_MOVING = addBroadphaseLayer( worldSettings );
	const BPL_STATIC = addBroadphaseLayer( worldSettings );
	const OL_MOVING = addObjectLayer( worldSettings, BPL_MOVING );
	const OL_STATIC = addObjectLayer( worldSettings, BPL_STATIC );

	enableCollision( worldSettings, OL_MOVING, OL_STATIC );
	enableCollision( worldSettings, OL_MOVING, OL_MOVING );

	const world = createWorld( worldSettings );
	world._OL_MOVING = OL_MOVING;
	world._OL_STATIC = OL_STATIC;

	buildWallColliders( world, null, customCells );

	const roadHalf = groundSize / 2;
	rigidBody.create( world, {
		shape: box.create( { halfExtents: [ roadHalf, 0.01, roadHalf ] } ),
		motionType: MotionType.STATIC,
		objectLayer: OL_STATIC,
		position: [ bounds.centerX, - 0.125, bounds.centerZ ],
		friction: 5.0,
		restitution: 0.0,
	} );

	const vKey   = vehicleKey || 'yellow';
	const vStats = JSON.parse( JSON.stringify( VEHICLE_STATS[ vKey ] || VEHICLE_STATS.yellow ) );
	upgradeService.applyDeltasToStats( vStats, vKey );

	const sphereBody = USE_ARCADE_VEHICLE
		? createChassisBody( world, spawn ? spawn.position : null, vStats )
		: createSphereBody( world, spawn ? spawn.position : null );

	const vehicle = new Vehicle( vStats );
	vehicle.rigidBody = sphereBody;
	vehicle.physicsWorld = world;

	if ( USE_ARCADE_VEHICLE ) {

		vehicle._rayFilter = initRayFilter( world );

	}

	if ( spawn ) {

		const [ sx, sy, sz ] = spawn.position;
		vehicle.spherePos.set( sx, sy, sz );
		vehicle.prevModelPos.set( sx, 0, sz );
		vehicle.container.rotation.y = spawn.angle;

	}

	const vehicleGroup = vehicle.init( models[ COLOR_TO_MODEL[ vKey ] || 'vehicle-truck-yellow' ], vStats );
	scene.add( vehicleGroup );

	dirLight.target = vehicleGroup;

	const cam = new Camera();
	cam.targetPosition.copy( vehicle.spherePos );

	const controls = new Controls();
	const particles = new SmokeTrails( scene );

	const audio = new GameAudio();
	audio.init( cam.camera );

	const _forward = new THREE.Vector3();

	const contactListener = {
		onContactAdded( bodyA, bodyB ) {

			if ( bodyA !== sphereBody && bodyB !== sphereBody ) return;

			const vel = sphereBody.motionProperties.linearVelocity;
			const impactVelocity = Math.sqrt( vel[ 0 ] * vel[ 0 ] + vel[ 2 ] * vel[ 2 ] );
			audio.playImpact( impactVelocity );

			// Speed penalty: reduce rigid body velocity on wall hit
			if ( impactVelocity > 1 ) {

				const keep = Math.max( 0.4, 1 - impactVelocity * 0.08 );
				rigidBody.setLinearVelocity( world, sphereBody, [
					vel[ 0 ] * keep, vel[ 1 ], vel[ 2 ] * keep
				] );

			}

		}
	};

	const timer = new THREE.Timer();
	timer.update(); // consume the initial delta so first frame starts at dt≈0

	function animate() {

		requestAnimationFrame( animate );

		timer.update();
		const dt = Math.min( timer.getDelta(), 1 / 30 );

		const input = controls.update();

		updateWorld( world, contactListener, dt );

		vehicle.update( dt, input );

		dirLight.position.set(
			vehicle.spherePos.x + 11.4,
			15,
			vehicle.spherePos.z - 5.3
		);

		cam.update( dt, vehicle.spherePos );
		particles.update( dt, vehicle );
		audio.update( dt, vehicle.linearSpeed, input.z, vehicle.driftIntensity );

		renderer.render( scene, cam.camera );

	}

	animate();

}

// ─── Multiplayer ──────────────────────────────────────────

function initMultiplayer( network, lobby, customCells, initialPhase, initialCountdown, vehicleKey ) {

	renderer.domElement.classList.remove( 'hidden' );

	const { bounds, trackObjects } = setupScene( customCells );

	const vKey = vehicleKey || 'yellow';
	const vStats = VEHICLE_STATS[ vKey ] || VEHICLE_STATS.yellow;
	const vehicle = new Vehicle( vStats );
	const remoteVehicles = new Map();
	const remoteProxyBodies = new Map(); // sessionId → kinematic body in localWorld
	const remoteParticles = new Map();   // sessionId → SmokeTrails

	const cam = new Camera();
	const controls = new Controls();
	const particles = new SmokeTrails( scene );

	const audio = new GameAudio();
	audio.init( cam.camera );

	const hud = new RaceHUD();

	// Initialize HUD from current state immediately
	const mode = network.raceMode || 'sandbox';
	hud.setMode( mode );

	if ( initialPhase === 'countdown' ) {

		hud.showCountdown( initialCountdown || 3 );

	} else if ( initialPhase === 'racing' ) {

		hud.showCountdown( 0 );

	}

	// ── Local physics world for client-side prediction ────
	registerAll();

	const localWorldSettings = createWorldSettings();
	localWorldSettings.gravity = [ 0, -9.81, 0 ];

	const BPL_MOVING = addBroadphaseLayer( localWorldSettings );
	const BPL_STATIC = addBroadphaseLayer( localWorldSettings );
	const OL_MOVING = addObjectLayer( localWorldSettings, BPL_MOVING );
	const OL_STATIC = addObjectLayer( localWorldSettings, BPL_STATIC );

	enableCollision( localWorldSettings, OL_MOVING, OL_STATIC );
	enableCollision( localWorldSettings, OL_MOVING, OL_MOVING );

	const localWorld = createWorld( localWorldSettings );
	localWorld._OL_MOVING = OL_MOVING;
	localWorld._OL_STATIC = OL_STATIC;
	localWorld._isServerWorld = true; // suppress client-side LINEAR_DAMP (server applies it)

	buildWallColliders( localWorld, null, customCells );

	const groundSize = Math.max( bounds.halfWidth, bounds.halfDepth ) * 2 + 20;
	const roadHalf = groundSize / 2;
	rigidBody.create( localWorld, {
		shape: box.create( { halfExtents: [ roadHalf, 0.01, roadHalf ] } ),
		motionType: MotionType.STATIC,
		objectLayer: OL_STATIC,
		position: [ bounds.centerX, -0.125, bounds.centerZ ],
		friction: 5.0,
		restitution: 0.0,
	} );

	let localSphereBody = null;
	let localVehicleReady = false;
	let running = true;

	const _forward = new THREE.Vector3();

	const localContactListener = {
		onContactAdded( bodyA, bodyB ) {

			if ( ! localSphereBody ) return;
			if ( bodyA !== localSphereBody && bodyB !== localSphereBody ) return;

			const vel = localSphereBody.motionProperties.linearVelocity;
			const impactVelocity = Math.sqrt( vel[ 0 ] * vel[ 0 ] + vel[ 2 ] * vel[ 2 ] );
			audio.playImpact( impactVelocity );

			// In multiplayer, the server is authoritative for speed penalties — only play sound locally.
			// Slow down reconciliation for a few frames so physics can settle after the impact
			// before server correction is applied (avoids flips/180s from mid-contact corrections).
			vehicle._postContactFrames = 4;

		}
	};

	// ── Spawn logic ───────────────────────────────────────

	function spawnPlayer( sessionId, color ) {

		// For local player, prefer server-confirmed vehicle (may differ from request if color conflict)
		const vehicleColor = sessionId === network.sessionId
			? ( network.getMyState()?.vehicle || color )
			: color;
		const modelName = COLOR_TO_MODEL[ vehicleColor ] || 'vehicle-truck-yellow';

		if ( sessionId === network.sessionId ) {

			if ( localVehicleReady ) return;

			const myState = network.getMyState();
			const spawnPos = myState ? [ myState.sx, myState.sy, myState.sz ] : null;

			// Create local physics body for prediction
			localSphereBody = USE_ARCADE_VEHICLE
				? createChassisBody( localWorld, spawnPos, vStats )
				: createSphereBody( localWorld, spawnPos );
			vehicle.rigidBody = localSphereBody;
			vehicle.physicsWorld = localWorld;

			if ( USE_ARCADE_VEHICLE ) {

				vehicle._rayFilter = initRayFilter( localWorld );

			}

			if ( myState ) {

				vehicle.spherePos.set( myState.sx, myState.sy, myState.sz );
				vehicle.prevModelPos.set( myState.sx, 0, myState.sz );
				vehicle.container.quaternion.set( myState.sqx, myState.sqy, myState.sqz, myState.sqw );

			}

			const vehicleGroup = vehicle.init( models[ modelName ], vStats );
			scene.add( vehicleGroup );
			dirLight.target = vehicleGroup;
			cam.targetPosition.copy( vehicle.spherePos );
			localVehicleReady = true;

		} else {

			if ( remoteVehicles.has( sessionId ) ) return;
			const remote = new RemoteVehicle();
			const group = remote.init( models[ modelName ] );
			scene.add( group );
			remoteVehicles.set( sessionId, remote );
			remoteParticles.set( sessionId, new SmokeTrails( scene ) );

			// Add a kinematic proxy body so the local player physically collides with remote players
			const state = network.getPlayerState( sessionId );
			const spawnPos = state ? [ state.sx, state.sy, state.sz ] : null;
			const proxyBody = createKinematicSphereBody( localWorld, spawnPos );
			remoteProxyBodies.set( sessionId, proxyBody );

		}

	}

	network.onPlayerAdd = ( sessionId, color ) => {

		spawnPlayer( sessionId, color );
		updateLobbyPlayers( network, lobby );

	};

	for ( const [ sessionId, state ] of network.playerStates ) {

		spawnPlayer( sessionId, state.color );

	}

	network.onPlayerRemove = ( sessionId ) => {

		const remote = remoteVehicles.get( sessionId );
		if ( remote ) {

			remote.dispose( scene );
			remoteVehicles.delete( sessionId );

		}

		const rp = remoteParticles.get( sessionId );
		if ( rp ) {

			rp.dispose( scene );
			remoteParticles.delete( sessionId );

		}

		remoteProxyBodies.delete( sessionId );

		updateLobbyPlayers( network, lobby );

	};

	// Whether the local player is host (created the room, not a joiner)
	const isHost = ! network._joinedExistingRoom;

	function handleReturnToLobby() {

		hud.hideResults( true );
		// Small delay to let the exit animation complete before cleanup
		setTimeout( () => {

			cleanupMultiplayer();
			hud.hideAll();
			lobby.show();
			network.onPlayerAdd    = () => updateLobbyPlayers( network, lobby );
			network.onPlayerRemove = () => updateLobbyPlayers( network, lobby );
			lobby.showRoom( network.roomId, isHost, network.roomCode );
			updateLobbyPlayers( network, lobby );

			lobby.onStartRace = ( { mode, laps } ) => {

				network.sendStartRace( mode, laps );

			};

			// Re-arm phase listener so the next race start re-launches initMultiplayer
			network.onPhaseChange = ( phase, countdown ) => {

				if ( phase === 'countdown' || phase === 'racing' ) {

					lobby.hide();
					initMultiplayer( network, lobby, customCells, phase, countdown, vKey );

				}

			};

		}, 280 );

	}

	// Apply rewards when the server confirms them
	network.onRaceReward = ( data ) => {

		profileService.applyRaceResult( data );
		hud.showRewardToast( data.xp_earned, data.credits_earned );

	};

	// Race phase changes
	network.onPhaseChange = ( phase, countdown ) => {

		if ( phase === 'countdown' ) {

			hud.setMode( 'race' );
			hud.showCountdown( countdown );

		} else if ( phase === 'racing' ) {

			hud.setMode( network.raceMode );
			hud.showCountdown( 0 );

		} else if ( phase === 'finished' ) {

			hud.showResults(
				network.playerStates,
				isHost,
				() => network.sendRestartRace(),   // Play Again (host only)
				handleReturnToLobby,               // Return to Lobby (all)
			);

		} else if ( phase === 'waiting' ) {

			// Host sent restartRace — go back to lobby for all players
			handleReturnToLobby();

		}

	};

	function cleanupMultiplayer() {

		running = false;

		// Remove track and decorations from scene
		for ( const obj of trackObjects ) {

			scene.remove( obj );

		}

		// Dispose all remote vehicles and their proxy bodies
		for ( const remote of remoteVehicles.values() ) {

			remote.dispose( scene );

		}

		remoteVehicles.clear();
		remoteProxyBodies.clear();

		for ( const rp of remoteParticles.values() ) {

			rp.dispose( scene );

		}

		remoteParticles.clear();

		// Dispose particles
		particles.dispose( scene );

		// Remove local vehicle from scene
		if ( vehicle.container.parent ) {

			scene.remove( vehicle.container );

		}

		// Reset dirLight target to avoid dangling reference
		dirLight.target = dirLight; // self-target = no effect

		// Hide the canvas — the lobby is pure DOM, no need for a stale game frame behind it
		renderer.domElement.classList.add( 'hidden' );

	}

	network.onDisconnect = ( code ) => {

		cleanupMultiplayer();
		hud.hideAll();
		lobby.show();
		lobby.showError( `Disconnected (code: ${ code }). Refresh to reconnect.` );

	};

	network.onError = ( code, message ) => {

		cleanupMultiplayer();
		hud.hideAll();
		lobby.show();
		lobby.showError( `Connection error: ${ message || code }` );

	};

	// ── Game loop with client-side prediction ─────────────

	const timer = new THREE.Timer();
	timer.update(); // consume the initial delta so first frame starts at dt≈0

	function animate() {

		if ( ! running ) return;
		requestAnimationFrame( animate );

		timer.update();
		const dt = Math.min( timer.getDelta(), 1 / 30 );

		const input = controls.update();
		network.sendInput( input );

		if ( localVehicleReady ) {

			const myState = network.getMyState();
			const isFrozen = network.racePhase === 'countdown' || network.racePhase === 'finished';

			if ( isFrozen ) {

				// During countdown/finish: pin physics body to server position before
				// stepping so it is already settled when racing begins — prevents the jump.
				if ( myState && vehicle.rigidBody ) {

					rigidBody.setPosition( localWorld, vehicle.rigidBody,
						[ myState.sx, myState.sy, myState.sz ], true );
					rigidBody.setLinearVelocity( localWorld, vehicle.rigidBody, [ 0, 0, 0 ] );
					rigidBody.setAngularVelocity( localWorld, vehicle.rigidBody, [ 0, 0, 0 ] );

				}

				// Step physics so the engine keeps the body awake and correctly placed
				updateWorld( localWorld, localContactListener, dt );
				vehicle.updateFromServer( dt, myState );

			} else {

				// Client-side prediction: run local physics for instant feedback
				updateWorld( localWorld, localContactListener, dt );
				vehicle.update( dt, input );

				// Reconcile toward server authority
				if ( myState ) {

					vehicle.reconcileFromServer( myState );

				}

			}

			dirLight.position.set(
				vehicle.spherePos.x + 11.4,
				15,
				vehicle.spherePos.z - 5.3
			);

			cam.update( dt, vehicle.spherePos );
			particles.update( dt, vehicle );
			audio.update( dt, vehicle.linearSpeed, input.z, vehicle.driftIntensity );

			hud.updateLapDisplay( myState, network.totalLaps );
			hud.updateLeaderboard( network.playerStates, network.totalLaps );

		}

		// Remote players: lerp toward server + update proxy collision bodies
		for ( const [ sessionId, remote ] of remoteVehicles ) {

			const state = network.getPlayerState( sessionId );
			remote.updateFromServer( dt, state );

			const rp = remoteParticles.get( sessionId );
			if ( rp ) rp.update( dt, remote );

			// Move kinematic proxy body to match server position for local collision detection
			const proxyBody = remoteProxyBodies.get( sessionId );
			if ( proxyBody && state ) {

				rigidBody.setPosition( localWorld, proxyBody, [ state.sx, state.sy, state.sz ], true );

			}

		}

		renderer.render( scene, cam.camera );

	}

	animate();

}

function updateLobbyPlayers( network, lobby ) {

	const players = [];
	let first = true;
	for ( const state of network.playerStates.values() ) {

		players.push( { color: state.color, username: state.username || '', isHost: first } );
		first = false;

	}
	lobby.updatePlayers( players );

}

function getServerUrl() {

	// Same origin — server serves both static files and WebSocket
	return window.location.origin;

}

// ─── Entry point ──────────────────────────────────────────

async function init() {

	await loadModels();

	const params = new URLSearchParams( window.location.search );
	const mapParam = params.get( 'map' );
	const roomParam = params.get( 'room' );

	// URL ?map= fallback (from editor share link)
	let urlCells = null;
	if ( mapParam ) {

		try {

			urlCells = decodeCells( mapParam );

		} catch ( e ) {

			console.warn( 'Invalid map parameter, using lobby selection' );

		}

	}

	const lobby = new Lobby();
	const network = new Network();

	// Resolve cells: lobby selection → URL param → server mapData → null (default in Track.js)
	function getActiveCells() {

		const lobbyCells = lobby.getSelectedCells();
		if ( lobbyCells ) return lobbyCells;
		if ( urlCells ) return urlCells;

		// Guest joining via ?room= link: decode track from server state
		const serverMap = network.roomMapData;
		if ( serverMap ) {

			try { return decodeCells( serverMap ); } catch ( _e ) { /* ignore */ }

		}

		return null;

	}

	// Encode the active circuit for the server. Priority: lobby selection → URL ?map= → ''
	function getMapParam() {

		const cells = lobby.getSelectedCells();
		if ( cells ) return encodeCells( cells );
		return mapParam || '';

	}

	async function startMultiplayer( roomId ) {

		const vehicleKey = lobby.getVehicle();
		const username   = lobby.getUsername();
		const upgrades   = upgradeService.getVehicleUpgrades( vehicleKey );

		lobby.showConnecting();

		try {

			await network.connect( getServerUrl(), getMapParam(), roomId || null, username, vehicleKey, upgrades );
			await waitForMyState();

		} catch ( e ) {

			console.error( 'Connection failed:', e );
			network.disconnect();
			const msg = e.message && e.message.includes( 'full' )
				? 'Room is full. Try creating a new one.'
				: e.message || 'Serveur inaccessible';
			lobby.showError( msg );
			return;

		}

		// Determine if this player is the host (first player in the room)
		const isHost = ! roomId;
		setupLobbyCallbacks( vehicleKey );
		lobby.showRoom( network.roomId, isHost, network.roomCode );
		updateLobbyPlayers( network, lobby );

	}

	// Helper: join a room by code (from mode screen)
	async function joinByCode( code ) {

		const vehicleKey = lobby.getVehicle();
		const username   = lobby.getUsername();
		const upgrades   = upgradeService.getVehicleUpgrades( vehicleKey );

		lobby.showConnecting();

		try {

			await network.joinByCode( getServerUrl(), code, username, vehicleKey, upgrades );
			await waitForMyState();

		} catch ( e ) {

			network.disconnect();
			lobby.showError( e.message || 'Code invalide' );
			return;

		}

		setupLobbyCallbacks( vehicleKey );
		lobby.showRoom( network.roomId, false, network.roomCode );
		updateLobbyPlayers( network, lobby );

	}

	// Wire up all lobby ↔ network callbacks once the room lobby is shown
	function setupLobbyCallbacks( vehicleKey ) {

		lobby.onStartRace = ( { mode, laps } ) => network.sendStartRace( mode, laps );

		lobby.onLeaveRoom = () => {

			network.disconnect();
			lobby._leaveRoom();
			lobby._buildModeScreen();

		};

		// Host: send new map to server when circuit changes
		lobby.onCircuitChange = ( cells ) => {

			network.sendSetMap( encodeCells( cells ) );

		};

		// Clients: update circuit preview when server broadcasts a map change
		network.onMapChange = ( mapData ) => {

			if ( ! mapData ) return;
			try {

				const cells = decodeCells( mapData );
				lobby.updateCircuit( cells, null );

			} catch ( _e ) { /* ignore invalid map */ }

		};

		// Phase changes → start game
		network.onPhaseChange = ( phase, countdown ) => {

			if ( phase === 'countdown' || phase === 'racing' ) {

				lobby.hide();
				initMultiplayer( network, lobby, getActiveCells(), phase, countdown, vehicleKey );

			}

		};

		network.onPlayerAdd    = () => updateLobbyPlayers( network, lobby );
		network.onPlayerRemove = () => updateLobbyPlayers( network, lobby );

	}

	// Helper: wait for the local player's state to appear in the network
	function waitForMyState() {

		return new Promise( ( resolve, reject ) => {

			if ( network.getMyState() ) { resolve(); return; }

			const TIMEOUT_MS = 10000;
			const timer = setTimeout( () => {

				reject( new Error( 'Timeout: le serveur ne répond pas' ) );

			}, TIMEOUT_MS );

			const done = () => clearTimeout( timer );

			const origAdd = network.onPlayerAdd;
			network.onPlayerAdd = ( sessionId, color ) => {

				if ( origAdd ) origAdd( sessionId, color );
				if ( sessionId === network.sessionId ) { done(); resolve(); }

			};

			const origDisconnect = network.onDisconnect;
			network.onDisconnect = ( code ) => {

				if ( origDisconnect ) origDisconnect( code );
				done();
				reject( new Error( 'Connexion perdue' ) );

			};

		} );

	}

	// If there's a ?room= param, go straight to mode screen so the user
	// can enter identity info if needed, then auto-join via the join-by-code flow.
	// If there's a ?room= param and identity is already set, auto-join directly.
	if ( roomParam ) {

		await startMultiplayer( roomParam );
		return;

	}

	lobby.onPlayOffline = () => {

		const cells = getActiveCells();
		const spawn = cells ? computeSpawnPosition( cells ) : null;
		lobby.hide();
		initSinglePlayer( cells, spawn, lobby.getVehicle() );

	};

	lobby.onPlayOnline = () => startMultiplayer( null );

	lobby.onJoinByCode = ( code ) => joinByCode( code );

}

init();
