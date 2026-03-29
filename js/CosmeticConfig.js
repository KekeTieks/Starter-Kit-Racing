// CosmeticConfig.js — Catalog of all cosmetic slots and items.
// Mirror on server if cosmetic validation is needed. Keep both in sync.
//
// HOW TO ADD A NEW SLOT
// 1. Add an entry to COSMETIC_SLOTS with a unique id, a display name, and a
//    description of what the slot represents on the vehicle.
// 2. Set `attachNode` to the GLB node name where the part should be parented
//    (e.g. 'body'). The applicator will search for it during traversal.
// 3. Set `type` to how the cosmetic is applied:
//      - 'model'    → swap / attach a GLB sub-model   (spoiler, bumper…)
//      - 'material' → swap the material on an existing mesh (paint, decal)
//      - 'color'    → change the color of an existing material (simple tint)
//
// HOW TO ADD A NEW ITEM
// 1. Add an entry to COSMETIC_ITEMS with a unique id and the slot it belongs to.
// 2. For 'model' items:  set `modelPath` to the GLB file in public/models/cosmetics/.
//    Optionally set `offset`, `rotation`, `scale` for fine-tuning placement.
// 3. For 'material' items: set `materialDef` (color, map, metalness, roughness…).
// 4. For 'color' items: set `color` to a hex value.
// 5. Optionally set `cost` (credits) and `requiredLevel` for unlock gating.
//
// The default item for each slot is always `null` (= stock appearance).

// ── Cosmetic slots ──────────────────────────────────────────────────────────

export const COSMETIC_SLOTS = [
	{
		id:          'paint',
		name:        'Peinture',
		description: 'Couleur de la carrosserie',
		icon:        '🎨',
		type:        'color',      // simple color tint on body meshes
		attachNode:  'body',       // node whose material(s) will be tinted
	},
	{
		id:          'wheels',
		name:        'Jantes',
		description: 'Style de jantes',
		icon:        '🛞',
		type:        'model',      // swap wheel meshes
		attachNode:  'wheel',      // applies to all nodes containing "wheel"
	},
	{
		id:          'spoiler',
		name:        'Spoiler',
		description: 'Aileron arrière',
		icon:        '🏁',
		type:        'model',
		attachNode:  'body',       // parented to body node
	},
	{
		id:          'bumper_front',
		name:        'Pare-choc avant',
		description: 'Protection avant',
		icon:        '🛡',
		type:        'model',
		attachNode:  'body',
	},
	{
		id:          'bumper_rear',
		name:        'Pare-choc arrière',
		description: 'Protection arrière',
		icon:        '🛡',
		type:        'model',
		attachNode:  'body',
	},
	{
		id:          'sideskirt',
		name:        'Bas de caisse',
		description: 'Jupes latérales',
		icon:        '📐',
		type:        'model',
		attachNode:  'body',
	},
	{
		id:          'decal',
		name:        'Décals',
		description: 'Autocollants et motifs sur la carrosserie',
		icon:        '🔖',
		type:        'material',   // overlay texture on body
		attachNode:  'body',
	},
];

// ── Cosmetic items ──────────────────────────────────────────────────────────
// Each item belongs to exactly one slot. `null` in a slot = stock (default).
//
// Items are defined here even before the actual GLB/textures exist so the
// code paths are exercised. The applicator gracefully skips missing assets.

export const COSMETIC_ITEMS = [

	// ── Paint ────────────────────────────────────────────────────────────
	{ id: 'paint_midnight',     slot: 'paint', name: 'Midnight Blue',    color: 0x1a237e, cost: 200,  requiredLevel: 1 },
	{ id: 'paint_crimson',      slot: 'paint', name: 'Crimson Red',      color: 0xb71c1c, cost: 200,  requiredLevel: 1 },
	{ id: 'paint_forest',       slot: 'paint', name: 'Forest Green',     color: 0x1b5e20, cost: 200,  requiredLevel: 1 },
	{ id: 'paint_gold',         slot: 'paint', name: 'Gold Rush',        color: 0xf9a825, cost: 350,  requiredLevel: 3 },
	{ id: 'paint_matte_black',  slot: 'paint', name: 'Matte Black',      color: 0x212121, cost: 500,  requiredLevel: 5 },
	{ id: 'paint_pearl_white',  slot: 'paint', name: 'Pearl White',      color: 0xf5f5f5, cost: 500,  requiredLevel: 5 },

	// ── Wheels ───────────────────────────────────────────────────────────
	// modelPath will point to GLB files once modeled.
	{ id: 'wheels_sport',    slot: 'wheels',  name: 'Sport Rims',    modelPath: 'models/cosmetics/wheels_sport.glb',    cost: 300,  requiredLevel: 2 },
	{ id: 'wheels_offroad',  slot: 'wheels',  name: 'Off-Road',      modelPath: 'models/cosmetics/wheels_offroad.glb',  cost: 300,  requiredLevel: 2 },
	{ id: 'wheels_chrome',   slot: 'wheels',  name: 'Chrome Deluxe', modelPath: 'models/cosmetics/wheels_chrome.glb',   cost: 600,  requiredLevel: 4 },

	// ── Spoiler ──────────────────────────────────────────────────────────
	{ id: 'spoiler_low',   slot: 'spoiler', name: 'Low Wing',   modelPath: 'models/cosmetics/spoiler_low.glb',   offset: [ 0, 0.45, -0.7 ], cost: 250, requiredLevel: 2 },
	{ id: 'spoiler_high',  slot: 'spoiler', name: 'High Wing',  modelPath: 'models/cosmetics/spoiler_high.glb',  offset: [ 0, 0.55, -0.7 ], cost: 400, requiredLevel: 4 },
	{ id: 'spoiler_gt',    slot: 'spoiler', name: 'GT Wing',    modelPath: 'models/cosmetics/spoiler_gt.glb',    offset: [ 0, 0.50, -0.7 ], cost: 700, requiredLevel: 6 },

	// ── Bumpers ──────────────────────────────────────────────────────────
	{ id: 'bumper_front_bull',  slot: 'bumper_front', name: 'Bull Bar',    modelPath: 'models/cosmetics/bumper_front_bull.glb',  offset: [ 0, 0, 0.85 ],  cost: 350, requiredLevel: 3 },
	{ id: 'bumper_rear_diff',   slot: 'bumper_rear',  name: 'Diffuser',    modelPath: 'models/cosmetics/bumper_rear_diff.glb',   offset: [ 0, 0, -0.85 ], cost: 350, requiredLevel: 3 },

	// ── Side skirts ──────────────────────────────────────────────────────
	{ id: 'sideskirt_aero', slot: 'sideskirt', name: 'Aero Skirts', modelPath: 'models/cosmetics/sideskirt_aero.glb', cost: 300, requiredLevel: 2 },

	// ── Decals ───────────────────────────────────────────────────────────
	// materialDef.mapPath will point to a texture file once created.
	{ id: 'decal_stripes',  slot: 'decal', name: 'Racing Stripes', materialDef: { mapPath: 'textures/cosmetics/decal_stripes.png' }, cost: 150, requiredLevel: 1 },
	{ id: 'decal_flames',   slot: 'decal', name: 'Flames',         materialDef: { mapPath: 'textures/cosmetics/decal_flames.png' },  cost: 250, requiredLevel: 3 },

];

// ── Helpers ─────────────────────────────────────────────────────────────────

const _slotMap = new Map( COSMETIC_SLOTS.map( ( s ) => [ s.id, s ] ) );
const _itemMap = new Map( COSMETIC_ITEMS.map( ( i ) => [ i.id, i ] ) );

/** Get slot definition by id. */
export function getSlot( slotId ) { return _slotMap.get( slotId ) || null; }

/** Get item definition by id. */
export function getItem( itemId ) { return _itemMap.get( itemId ) || null; }

/** Get all items for a given slot. */
export function getItemsForSlot( slotId ) { return COSMETIC_ITEMS.filter( ( i ) => i.slot === slotId ); }
