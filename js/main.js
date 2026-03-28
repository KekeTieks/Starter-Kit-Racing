import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { createWorldSettings, createWorld, addBroadphaseLayer, addObjectLayer, enableCollision, registerAll, updateWorld, rigidBody, box, MotionType } from 'crashcat';
import { Vehicle } from './Vehicle.js';
import { RemoteVehicle } from './RemoteVehicle.js';
import { Camera } from './Camera.js';
import { Controls } from './Controls.js';
import { buildTrack, decodeCells, computeSpawnPosition, computeTrackBounds } from './Track.js';
import { buildWallColliders, createSphereBody } from './Physics.js';
import { SmokeTrails } from './Particles.js';
import { GameAudio } from './Audio.js';
import { Network } from './Network.js';
import { Lobby } from './Lobby.js';
import { RaceHUD } from './RaceHUD.js';


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

	buildTrack( scene, models, customCells );

	return bounds;

}

// ─── Single-player ────────────────────────────────────────

function initSinglePlayer( customCells, spawn ) {

	const bounds = setupScene( customCells );
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

	const sphereBody = createSphereBody( world, spawn ? spawn.position : null );

	const vehicle = new Vehicle();
	vehicle.rigidBody = sphereBody;
	vehicle.physicsWorld = world;

	if ( spawn ) {

		const [ sx, sy, sz ] = spawn.position;
		vehicle.spherePos.set( sx, sy, sz );
		vehicle.prevModelPos.set( sx, 0, sz );
		vehicle.container.rotation.y = spawn.angle;

	}

	const vehicleGroup = vehicle.init( models[ 'vehicle-truck-yellow' ] );
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

			_forward.set( 0, 0, 1 ).applyQuaternion( vehicle.container.quaternion );
			_forward.y = 0;
			_forward.normalize();

			const impactVelocity = Math.abs( vehicle.modelVelocity.dot( _forward ) );
			audio.playImpact( impactVelocity );

		}
	};

	const timer = new THREE.Timer();

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

function initMultiplayer( network, lobby, customCells, initialPhase, initialCountdown ) {

	const bounds = setupScene( customCells );

	const vehicle = new Vehicle();
	const remoteVehicles = new Map();

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

			_forward.set( 0, 0, 1 ).applyQuaternion( vehicle.container.quaternion );
			_forward.y = 0;
			_forward.normalize();

			const impactVelocity = Math.abs( vehicle.modelVelocity.dot( _forward ) );
			audio.playImpact( impactVelocity );

		}
	};

	// ── Spawn logic ───────────────────────────────────────

	function spawnPlayer( sessionId, color ) {

		const modelName = COLOR_TO_MODEL[ color ] || 'vehicle-truck-yellow';

		if ( sessionId === network.sessionId ) {

			if ( localVehicleReady ) return;

			const myState = network.getMyState();
			const spawnPos = myState ? [ myState.sx, myState.sy, myState.sz ] : null;

			// Create local physics body for prediction
			localSphereBody = createSphereBody( localWorld, spawnPos );
			vehicle.rigidBody = localSphereBody;
			vehicle.physicsWorld = localWorld;

			if ( myState ) {

				vehicle.spherePos.set( myState.sx, myState.sy, myState.sz );
				vehicle.prevModelPos.set( myState.sx, 0, myState.sz );
				vehicle.container.quaternion.set( myState.sqx, myState.sqy, myState.sqz, myState.sqw );

			}

			const vehicleGroup = vehicle.init( models[ modelName ] );
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

		updateLobbyPlayers( network, lobby );

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

			hud.showResults( network.playerStates );

		}

	};

	function cleanupMultiplayer() {

		running = false;

		// Dispose all remote vehicles
		for ( const remote of remoteVehicles.values() ) {

			remote.dispose( scene );

		}

		remoteVehicles.clear();

		// Dispose particles
		particles.dispose( scene );

		// Remove local vehicle from scene
		if ( vehicle.container.parent ) {

			scene.remove( vehicle.container );

		}

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

				// During countdown/finish, apply server state directly (no local physics)
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

		// Remote players: lerp toward server
		for ( const [ sessionId, remote ] of remoteVehicles ) {

			const state = network.getPlayerState( sessionId );
			remote.updateFromServer( dt, state );

		}

		renderer.render( scene, cam.camera );

	}

	animate();

}

function updateLobbyPlayers( network, lobby ) {

	const players = [];
	for ( const state of network.playerStates.values() ) {

		players.push( { color: state.color } );

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

	let customCells = null;
	let spawn = null;

	if ( mapParam ) {

		try {

			customCells = decodeCells( mapParam );
			spawn = computeSpawnPosition( customCells );

		} catch ( e ) {

			console.warn( 'Invalid map parameter, using default track' );

		}

	}

	const lobby = new Lobby();
	const network = new Network();

	async function startMultiplayer( roomId ) {

		lobby.showConnecting();

		try {

			await network.connect( getServerUrl(), mapParam, roomId || null );

		} catch ( e ) {

			console.error( 'Connection failed:', e );
			const msg = e.message && e.message.includes( 'full' )
				? 'Room is full. Try creating a new one.'
				: `Failed to connect: ${ e.message || 'server unreachable' }`;
			lobby.showError( msg );
			return;

		}

		// Wait for local player state to arrive
		await new Promise( ( resolve ) => {

			if ( network.getMyState() ) {

				resolve();
				return;

			}

			const originalOnAdd = network.onPlayerAdd;
			network.onPlayerAdd = ( sessionId, color ) => {

				if ( originalOnAdd ) originalOnAdd( sessionId, color );
				if ( sessionId === network.sessionId ) resolve();

			};

		} );

		// Determine if this player is the host (first player in the room)
		const isHost = ! roomId;
		lobby.showRoom( network.roomId, isHost );
		updateLobbyPlayers( network, lobby );

		// Host: lobby stays visible until they click Start
		// Guest: lobby stays visible until host starts (phase changes)
		lobby.onStartRace = ( { mode, laps } ) => {

			network.sendStartRace( mode, laps );

		};

		// Listen for phase change to transition from lobby to game
		network.onPhaseChange = ( phase, countdown ) => {

			if ( phase === 'countdown' || phase === 'racing' ) {

				lobby.hide();
				initMultiplayer( network, lobby, customCells, phase, countdown );

			}

		};

	}

	// If there's a room param, auto-join
	if ( roomParam ) {

		await startMultiplayer( roomParam );
		return;

	}

	lobby.onPlayOffline = () => {

		lobby.hide();
		initSinglePlayer( customCells, spawn );

	};

	lobby.onPlayOnline = () => startMultiplayer( null );

	lobby.onJoinRoom = ( roomId ) => startMultiplayer( roomId );

}

init();
