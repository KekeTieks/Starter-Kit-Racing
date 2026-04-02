import { schema } from "@colyseus/schema";

export const PlayerState = schema({
    // Sphere position (authoritative from physics)
    x: "number",
    y: "number",
    z: "number",
    // Container quaternion (facing direction)
    qx: "number",
    qy: "number",
    qz: "number",
    qw: { type: "number", default: 1 },
    // Linear velocity (for client reconciliation)
    vx: "number",
    vy: "number",
    vz: "number",
    // Angular velocity (for client reconciliation on slopes/ramps)
    avx: "number",
    avy: "number",
    avz: "number",
    // Last processed input sequence (for client-side prediction reconciliation)
    lastInputSeq: "number",
    // Server wall-clock timestamp when this state was computed (ms, for client extrapolation)
    stateTs: "number",
    // Whether the vehicle is airborne (all wheels off ground) — used by client reconciliation
    airborne: { type: "boolean", default: false },
    // Values needed for client-side visuals (wheels, body tilt, particles, audio)
    linearSpeed: "number",
    acceleration: "number",
    driftIntensity: "number",
    inputX: "number",
    inputZ: "number",
    // Vehicle color and identity
    color: "string",
    username: { type: "string", default: "" },
    vehicle: { type: "string", default: "yellow" },
    // Race state per player
    currentLap: "number",
    lapTime: "number",
    totalTime: "number",
    finishPosition: "number",
    finished: { type: "boolean", default: false },
    raceProgress: "number", // currentLap + fraction of current lap (0..1) for live ranking
});

export const RaceState = schema({
    players: { map: PlayerState, default: new Map() },
    mapData: { type: "string", default: "" },
    mode: { type: "string", default: "sandbox" },
    phase: { type: "string", default: "waiting" },
    countdown: "number",
    totalLaps: { type: "number", default: 3 },
    raceTimer: "number",
    finishCount: "number",
    roomCode: { type: "string", default: "" },
    weather: { type: "string", default: "clear" },
});
