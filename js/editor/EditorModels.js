// ─── EditorModels.js ──────────────────────────────────────────────────────────
// GLB model loading for track pieces.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const models = {};

const loader = new GLTFLoader();
const modelNames = [ 'track-straight', 'track-corner', 'track-bump', 'track-finish' ];

export function loadModels() {

	const promises = modelNames.map( ( name ) =>
		new Promise( ( resolve, reject ) => {

			loader.load( `models/${ name }.glb`, ( gltf ) => {

				gltf.scene.traverse( ( child ) => {

					if ( child.isMesh ) child.material.side = THREE.FrontSide;

				} );

				models[ name ] = gltf.scene;
				resolve();

			}, undefined, reject );

		} )
	);

	return Promise.all( promises );

}
