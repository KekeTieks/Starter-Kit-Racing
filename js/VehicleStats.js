// Vehicle stats — used by both client (Vehicle.js) and lobby (Lobby.js)
// Server uses server/simulation/VehicleStats.js (identical copy, no ES module boundary issue)

export const VEHICLE_STATS = {
	yellow: {
		maxSpeed:     1.0,
		accelRate:    6,
		steeringMult: 4.0,
		driveMult:    100,
		// Display bars (out of 5)
		display: { speed: 3, handling: 3, acceleration: 3 },
	},
	green: {
		maxSpeed:     0.9,
		accelRate:    8,
		steeringMult: 5.5,
		driveMult:    90,
		display: { speed: 2, handling: 5, acceleration: 4 },
	},
	purple: {
		maxSpeed:     1.1,
		accelRate:    5,
		steeringMult: 3.5,
		driveMult:    115,
		display: { speed: 4, handling: 2, acceleration: 2 },
	},
	red: {
		maxSpeed:     1.0,
		accelRate:    7,
		steeringMult: 4.5,
		driveMult:    100,
		display: { speed: 3, handling: 4, acceleration: 4 },
	},
};
