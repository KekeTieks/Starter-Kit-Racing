// CosmeticApplicator.js — Applies a cosmetic loadout to a Three.js vehicle.
//
// Usage:
//   import { applyCosmetics } from './CosmeticApplicator.js';
//   // After vehicle.init( model ) or remoteVehicle.init( model ):
//   await applyCosmetics( vehicle.container, loadout );
//
// The applicator is stateless: it reads the loadout, finds the relevant nodes
// in the vehicle hierarchy, and applies each cosmetic. It can be called again
// to update cosmetics at runtime (e.g. preview in a shop).
//
// It gracefully handles missing assets (GLB not yet modeled, texture not yet
// created) by logging a warning and skipping the item.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getSlot, getItem, COSMETIC_SLOTS } from './CosmeticConfig.js';

const _loader = new GLTFLoader();

// Cache loaded GLB scenes so they are only fetched once per session.
const _modelCache = new Map();

// Tag applied cosmetic nodes so we can remove them on re-apply.
const COSMETIC_TAG = '__cosmetic';

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Apply a full loadout to a vehicle container.
 *
 * @param {THREE.Group} container  — vehicle.container (root Group)
 * @param {Object}      loadout    — { [slotId]: itemId | null }
 * @param {Object}      [options]
 * @param {boolean}     [options.removeOld=true] — strip previously applied cosmetics first
 */
export async function applyCosmetics( container, loadout, options = {} ) {

	const { removeOld = true } = options;

	if ( removeOld ) _stripCosmetics( container );

	// Collect nodes by name once (cheaper than re-traversing per slot)
	const nodesByName = _indexNodes( container );

	const promises = [];

	for ( const slot of COSMETIC_SLOTS ) {

		const itemId = loadout[ slot.id ];
		if ( ! itemId ) continue; // stock — nothing to do

		const item = getItem( itemId );
		if ( ! item ) { console.warn( `[Cosmetics] Unknown item "${ itemId }", skipping.` ); continue; }

		switch ( slot.type ) {

			case 'color':
				_applyColor( nodesByName, slot, item );
				break;

			case 'material':
				promises.push( _applyMaterial( nodesByName, slot, item ) );
				break;

			case 'model':
				promises.push( _applyModel( container, nodesByName, slot, item ) );
				break;

		}

	}

	if ( promises.length > 0 ) await Promise.all( promises );

}

/**
 * Strip all previously applied cosmetics from a vehicle so it returns
 * to stock appearance. Safe to call even if no cosmetics were applied.
 */
export function stripCosmetics( container ) {

	_stripCosmetics( container );

}

// ── Color slot ──────────────────────────────────────────────────────────────

function _applyColor( nodesByName, slot, item ) {

	const targetNodes = _findAttachNodes( nodesByName, slot.attachNode );
	const color = new THREE.Color( item.color );

	for ( const node of targetNodes ) {

		node.traverse( ( child ) => {

			if ( ! child.isMesh ) return;

			// Clone the material so we don't bleed into other vehicles
			if ( ! child.userData[ COSMETIC_TAG + '_origMat' ] ) {

				child.userData[ COSMETIC_TAG + '_origMat' ] = child.material;

			}

			child.material = child.material.clone();
			child.material.color.copy( color );
			child.userData[ COSMETIC_TAG ] = true;

		} );

	}

}

// ── Material slot (texture overlay) ─────────────────────────────────────────

async function _applyMaterial( nodesByName, slot, item ) {

	if ( ! item.materialDef?.mapPath ) return;

	let texture;
	try {

		texture = await new THREE.TextureLoader().loadAsync( item.materialDef.mapPath );

	} catch ( _e ) {

		console.warn( `[Cosmetics] Texture not found: ${ item.materialDef.mapPath }, skipping.` );
		return;

	}

	texture.flipY = false;

	const targetNodes = _findAttachNodes( nodesByName, slot.attachNode );

	for ( const node of targetNodes ) {

		node.traverse( ( child ) => {

			if ( ! child.isMesh ) return;

			if ( ! child.userData[ COSMETIC_TAG + '_origMat' ] ) {

				child.userData[ COSMETIC_TAG + '_origMat' ] = child.material;

			}

			child.material = child.material.clone();
			child.material.map = texture;
			child.material.needsUpdate = true;
			child.userData[ COSMETIC_TAG ] = true;

		} );

	}

}

// ── Model slot (attach GLB part) ────────────────────────────────────────────

async function _applyModel( container, nodesByName, slot, item ) {

	if ( ! item.modelPath ) return;

	let scene;
	try {

		scene = await _loadModel( item.modelPath );

	} catch ( _e ) {

		console.warn( `[Cosmetics] Model not found: ${ item.modelPath }, skipping.` );
		return;

	}

	const part = scene.clone();
	part.userData[ COSMETIC_TAG ] = true;
	part.name = COSMETIC_TAG + '_' + item.id;

	// Position / rotation / scale overrides from item definition
	if ( item.offset ) part.position.fromArray( item.offset );
	if ( item.rotation ) part.rotation.fromArray( item.rotation );
	if ( item.scale ) {

		const s = typeof item.scale === 'number' ? [ item.scale, item.scale, item.scale ] : item.scale;
		part.scale.fromArray( s );

	}

	// Enable shadows on all meshes
	part.traverse( ( child ) => {

		if ( child.isMesh ) {

			child.castShadow = true;
			child.receiveShadow = true;

		}

	} );

	// Wheel slot is special: replaces the mesh inside each wheel node
	if ( slot.id === 'wheels' ) {

		_applyWheelModel( nodesByName, part );
		return;

	}

	// For other model slots, parent the part to the attach node
	const attachTargets = _findAttachNodes( nodesByName, slot.attachNode );
	const parent = attachTargets[ 0 ] || container;
	parent.add( part );

}

/**
 * Replace the visual mesh of every wheel node with the cosmetic wheel model.
 * Keeps the original Object3D hierarchy intact (position, rotation, name)
 * so that steering and suspension animations still work.
 */
function _applyWheelModel( nodesByName, wheelModel ) {

	const wheelNodes = _findAttachNodes( nodesByName, 'wheel' );

	for ( const wheelNode of wheelNodes ) {

		// Hide existing wheel meshes (don't remove — they carry the transform)
		wheelNode.traverse( ( child ) => {

			if ( child.isMesh ) {

				if ( ! child.userData[ COSMETIC_TAG + '_origVisible' ] ) {

					child.userData[ COSMETIC_TAG + '_origVisible' ] = child.visible;

				}

				child.visible = false;
				child.userData[ COSMETIC_TAG ] = true;

			}

		} );

		// Add cosmetic wheel mesh as child
		const clone = wheelModel.clone();
		clone.userData[ COSMETIC_TAG ] = true;
		clone.name = COSMETIC_TAG + '_wheel';
		wheelNode.add( clone );

	}

}

// ── Cleanup ─────────────────────────────────────────────────────────────────

function _stripCosmetics( container ) {

	const toRemove = [];

	container.traverse( ( child ) => {

		if ( child.userData[ COSMETIC_TAG ] ) {

			// Restore original material if we swapped it
			if ( child.userData[ COSMETIC_TAG + '_origMat' ] ) {

				child.material = child.userData[ COSMETIC_TAG + '_origMat' ];
				delete child.userData[ COSMETIC_TAG + '_origMat' ];

			}

			// Restore original visibility if we hid it
			if ( child.userData[ COSMETIC_TAG + '_origVisible' ] !== undefined ) {

				child.visible = child.userData[ COSMETIC_TAG + '_origVisible' ];
				delete child.userData[ COSMETIC_TAG + '_origVisible' ];

			}

			// If this node was added by us (model parts), mark for removal
			if ( child.name && child.name.startsWith( COSMETIC_TAG + '_' ) ) {

				toRemove.push( child );

			}

			delete child.userData[ COSMETIC_TAG ];

		}

	} );

	for ( const obj of toRemove ) {

		if ( obj.parent ) obj.parent.remove( obj );

	}

}

// ── Internal helpers ────────────────────────────────────────────────────────

/** Build a Map<lowerCaseName, node[]> from the container hierarchy. */
function _indexNodes( container ) {

	const map = new Map();

	container.traverse( ( child ) => {

		const name = ( child.name || '' ).toLowerCase();
		if ( ! name ) return;
		if ( ! map.has( name ) ) map.set( name, [] );
		map.get( name ).push( child );

	} );

	return map;

}

/**
 * Find nodes matching an attachNode pattern.
 * Exact match first, then partial (includes).
 */
function _findAttachNodes( nodesByName, attachNode ) {

	const key = attachNode.toLowerCase();
	// Exact match
	if ( nodesByName.has( key ) ) return nodesByName.get( key );

	// Partial match (e.g. 'wheel' matches 'wheel_front_left')
	const results = [];
	for ( const [ name, nodes ] of nodesByName ) {

		if ( name.includes( key ) ) results.push( ...nodes );

	}

	return results;

}

/** Load a GLB model with caching. */
function _loadModel( path ) {

	if ( _modelCache.has( path ) ) return Promise.resolve( _modelCache.get( path ) );

	return new Promise( ( resolve, reject ) => {

		_loader.load( path, ( gltf ) => {

			_modelCache.set( path, gltf.scene );
			resolve( gltf.scene );

		}, undefined, reject );

	} );

}
