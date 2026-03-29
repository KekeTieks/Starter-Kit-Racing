// Upgrade configuration — server-side copy.
// Mirror of js/UpgradeConfig.js. Keep both in sync when adding new upgrades.

export const MAX_UPGRADE_LEVEL = 5;

export const UPGRADE_CONFIG = [
    {
        id:    'engine',
        name:  'Moteur',
        levels: [
            { cost: 150,  delta: { engineForce: 300,  maxSpeed: 0.04 } },
            { cost: 250,  delta: { engineForce: 350,  maxSpeed: 0.05 } },
            { cost: 400,  delta: { engineForce: 400,  maxSpeed: 0.06 } },
            { cost: 600,  delta: { engineForce: 450,  maxSpeed: 0.07 } },
            { cost: 900,  delta: { engineForce: 500,  maxSpeed: 0.08 } },
        ],
    },
    {
        id:    'brakes',
        name:  'Freins',
        levels: [
            { cost: 100,  delta: { brakeForce: 400 } },
            { cost: 180,  delta: { brakeForce: 500 } },
            { cost: 280,  delta: { brakeForce: 600 } },
            { cost: 420,  delta: { brakeForce: 700 } },
            { cost: 650,  delta: { brakeForce: 800 } },
        ],
    },
    {
        id:    'grip',
        name:  'Adhérence',
        levels: [
            { cost: 200,  delta: { gripFront: 0.3,  gripRear: 0.3  } },
            { cost: 320,  delta: { gripFront: 0.35, gripRear: 0.35 } },
            { cost: 480,  delta: { gripFront: 0.4,  gripRear: 0.4  } },
            { cost: 700,  delta: { gripFront: 0.45, gripRear: 0.45 } },
            { cost: 1000, delta: { gripFront: 0.5,  gripRear: 0.5  } },
        ],
    },
    {
        id:    'weight',
        name:  'Allègement',
        levels: [
            { cost: 180,  delta: { mass: -30 } },
            { cost: 280,  delta: { mass: -35 } },
            { cost: 420,  delta: { mass: -40 } },
            { cost: 600,  delta: { mass: -45 } },
            { cost: 850,  delta: { mass: -50 } },
        ],
    },
];
