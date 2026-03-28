# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A JavaScript/Three.js racing game ported from [Kenney's Starter Kit Racing](https://github.com/KenneyNL/Starter-Kit-Racing) (Godot 4.6). Uses [crashcat](https://github.com/isaac-mason/crashcat) for physics. No build step — pure ES modules loaded via import maps from CDN.

## Running Locally

Serve the root directory with any static HTTP server (import maps require it):
```bash
npx serve .
# or
python -m http.server
```
Open `index.html` to play, `editor.html` for the track editor. Custom tracks are passed via `?map=<base64url>` query param.

There are no tests, linter, or build commands.

## Architecture

**Game loop** (`main.js`): Sets up Three.js renderer with bloom post-processing, loads GLB models, initializes crashcat physics world (broadphase layers, object layers, collision pairs), then runs `requestAnimationFrame` loop that ticks physics → vehicle → camera → particles → audio → render.

**Physics model**: The vehicle is a crashcat dynamic sphere body (`Physics.js:createSphereBody`). Driving force is applied as angular velocity on the sphere. Wall collisions use static box colliders approximating the Godot concave polygon shapes. Track pieces have two wall types:
- Straight/finish: two parallel box colliders per cell
- Corner: arc of box segments for outer wall + inner wall, centered at `(-CELL_HALF, +CELL_HALF)` in local cell space

**Track system** (`Track.js`): Grid-based layout where each cell is `[gx, gz, pieceType, godotOrient]`. Cell size is `CELL_RAW=9.99`, scaled by `GRID_SCALE=0.75`. Orientation uses Godot GridMap indices `{0: 0°, 10: 180°, 16: 90°, 22: 270°}`. Track data is encoded/decoded as base64url (3 bytes per cell) for URL sharing.

**Vehicle** (`Vehicle.js`): Two input modes — keyboard/gamepad (standard steering + throttle) and touch (joystick defines world-space direction with auto-gas). Visual model tilts body and spins wheels based on acceleration/steering. Falls below y=-10 trigger a position reset.

**Controls** (`Controls.js`): Unified input from keyboard (WASD/arrows), gamepad (left stick + triggers), and touch (virtual joystick). Touch input is rotated 45° to match the isometric camera angle.

**Camera** (`Camera.js`): Fixed isometric-style offset (45° azimuth, 35° elevation, distance 16) that lerp-follows the vehicle.

## Multiplayer (Colyseus)

**Server** (`server/`): Node.js Colyseus 0.17 server with server-authoritative physics. Run with `cd server && npm install && node index.js` (port 2567).

**Architecture**: Server runs crashcat physics at 60Hz. Clients send only inputs, receive authoritative state via Colyseus schema sync (delta-encoded binary patches at ~20Hz). Clients interpolate between snapshots for smooth 60fps rendering.

**Simulation loop** (3-phase in `RaceRoom.tick()`):
1. `sim.applyInput(dt)` — process inputs, apply driving forces to sphere bodies
2. `updateWorld()` — step crashcat physics
3. `sim.readBack(dt)` — read authoritative positions, compute derived values (drift, acceleration), sync to schema

**Key files**:
- `server/rooms/RaceRoom.js` — Room lifecycle, physics loop, input validation
- `server/simulation/VehicleSim.js` — Pure vehicle simulation (no Three.js dependency, custom quaternion math)
- `server/simulation/PhysicsWorld.js` — crashcat world + wall colliders for server
- `server/schema/RaceState.js` — Colyseus schema (PlayerState with position/quaternion/speed)
- `js/Network.js` — Client Colyseus connection, interpolation state management
- `js/RemoteVehicle.js` — Render-only vehicle for other players (interpolated)
- `js/Lobby.js` — DOM lobby UI (create/join room, player list, share link)

**Client flow**: `main.js` branches into `initSinglePlayer()` (offline, original physics) or `initMultiplayer()` (networked, no local physics). The lobby waits for the local player's state to arrive before starting the game loop (no race condition).

**Room sharing**: `?room=XXXX` URL param joins an existing room directly.

## Key Constants

- Vehicle models use `scale=0.5` (matching Godot `root_scale`)
- Track group sits at `y=-0.5`
- Sphere body: mass=1000, friction=5, angularDamping=4, gravityFactor=1.5
- Wall colliders: friction=0, restitution=0.1
- Dependencies are pinned: Three.js r183.2, crashcat 0.0.2, Colyseus 0.17.8, @colyseus/schema 4.0.19
