// CosmeticConfig.js — Server-side mirror of js/CosmeticConfig.js.
// Keep both in sync when adding new cosmetic slots or items.

export const COSMETIC_ITEMS = [
    // Paint
    { id: 'paint_midnight',     slot: 'paint', cost: 200,  requiredLevel: 1 },
    { id: 'paint_crimson',      slot: 'paint', cost: 200,  requiredLevel: 1 },
    { id: 'paint_forest',       slot: 'paint', cost: 200,  requiredLevel: 1 },
    { id: 'paint_gold',         slot: 'paint', cost: 350,  requiredLevel: 3 },
    { id: 'paint_matte_black',  slot: 'paint', cost: 500,  requiredLevel: 5 },
    { id: 'paint_pearl_white',  slot: 'paint', cost: 500,  requiredLevel: 5 },
    // Wheels
    { id: 'wheels_sport',       slot: 'wheels',       cost: 300,  requiredLevel: 2 },
    { id: 'wheels_offroad',     slot: 'wheels',       cost: 300,  requiredLevel: 2 },
    { id: 'wheels_chrome',      slot: 'wheels',       cost: 600,  requiredLevel: 4 },
    // Spoiler
    { id: 'spoiler_low',        slot: 'spoiler',      cost: 250,  requiredLevel: 2 },
    { id: 'spoiler_high',       slot: 'spoiler',      cost: 400,  requiredLevel: 4 },
    { id: 'spoiler_gt',         slot: 'spoiler',      cost: 700,  requiredLevel: 6 },
    // Bumpers
    { id: 'bumper_front_bull',  slot: 'bumper_front', cost: 350,  requiredLevel: 3 },
    { id: 'bumper_rear_diff',   slot: 'bumper_rear',  cost: 350,  requiredLevel: 3 },
    // Side skirts
    { id: 'sideskirt_aero',     slot: 'sideskirt',    cost: 300,  requiredLevel: 2 },
    // Decals
    { id: 'decal_stripes',      slot: 'decal',        cost: 150,  requiredLevel: 1 },
    { id: 'decal_flames',       slot: 'decal',        cost: 250,  requiredLevel: 3 },
];

const _itemMap = new Map( COSMETIC_ITEMS.map( ( i ) => [ i.id, i ] ) );

export function getItem( itemId ) { return _itemMap.get( itemId ) || null; }

export const VALID_ITEM_IDS = new Set( COSMETIC_ITEMS.map( ( i ) => i.id ) );

export const VALID_VEHICLES = new Set( [ 'yellow', 'green', 'purple', 'red' ] );
