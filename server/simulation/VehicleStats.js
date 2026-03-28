// Vehicle stats — server-side copy (mirrors js/VehicleStats.js)
// Kept separate to avoid ES module cross-boundary imports between client and server

export const VEHICLE_STATS = {
	yellow: {
		maxSpeed:     1.0,
		accelRate:    6,
		steeringMult: 4.0,
		driveMult:    100,
	},
	green: {
		maxSpeed:     0.9,
		accelRate:    8,
		steeringMult: 5.5,
		driveMult:    90,
	},
	purple: {
		maxSpeed:     1.1,
		accelRate:    5,
		steeringMult: 3.5,
		driveMult:    115,
	},
	red: {
		maxSpeed:     1.0,
		accelRate:    7,
		steeringMult: 4.5,
		driveMult:    100,
	},
};
