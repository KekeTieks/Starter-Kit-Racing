import * as THREE from 'three';
import { applyCosmetics } from './CosmeticApplicator.js';

const _FALLBACK_FRONT = [
    new THREE.Vector3( -0.151, 0.297, 0.756 ),
    new THREE.Vector3(  0.150, 0.297, 0.756 ),
];
const _FALLBACK_REAR = [
    new THREE.Vector3( -0.196, 0.398, -0.663 ),
    new THREE.Vector3(  0.196, 0.398, -0.663 ),
];

function _makeFallbackNodes( anchors, container ) {

    return anchors.map( ( pos ) => {

        const obj = new THREE.Object3D();
        obj.position.copy( pos );
        container.add( obj );
        return obj;

    } );

}

const _currQ = new THREE.Quaternion();

function lerpAngle( a, b, t ) {

    let diff = b - a;
    while ( diff > Math.PI ) diff -= Math.PI * 2;
    while ( diff < -Math.PI ) diff += Math.PI * 2;
    return a + diff * t;

}

export class RemoteVehicle {

    constructor() {

        this.container = new THREE.Group();
        this.bodyNode = null;
        this.wheels = [];
        this.wheelFL = null;
        this.wheelFR = null;
        this.wheelBL = null;
        this.wheelBR = null;

        this.spherePos = new THREE.Vector3();
        this.linearSpeed = 0;
        this.acceleration = 0;
        this.driftIntensity = 0;
        this.inputX = 0;
        this.inputZ = 0;

        this.prevModelPos = new THREE.Vector3();
        this.modelVelocity = new THREE.Vector3();

    }

    init( model ) {

        const vehicleModel = model.clone();
        this.container.add( vehicleModel );

        this._frontLightNodes = [];
        this._rearLightNodes  = [];

        vehicleModel.traverse( ( child ) => {

            const name = child.name.toLowerCase();

            if ( name === 'body' ) {

                child.rotation.order = 'YXZ';
                this.bodyNode = child;

            } else if ( name.includes( 'wheel' ) ) {

                child.rotation.order = 'YXZ';
                this.wheels.push( child );

                if ( name.includes( 'front' ) && name.includes( 'left' ) ) this.wheelFL = child;
                if ( name.includes( 'front' ) && name.includes( 'right' ) ) this.wheelFR = child;
                if ( name.includes( 'back' ) && name.includes( 'left' ) ) this.wheelBL = child;
                if ( name.includes( 'back' ) && name.includes( 'right' ) ) this.wheelBR = child;

            } else if ( name.includes( 'headlight' ) ) {

                if ( name.includes( 'rear' ) ) {

                    this._rearLightNodes.push( child );

                } else {

                    this._frontLightNodes.push( child );

                }

            }

            if ( child.isMesh ) {

                child.castShadow = true;
                child.receiveShadow = true;

            }

        } );

        return this.container;

    }

    /**
     * Apply a cosmetic loadout received from the network.
     * @param {Object} loadout — { [slotId]: itemId | null }
     */
    async applyLoadout( loadout ) {

        if ( loadout ) await applyCosmetics( this.container, loadout );

    }

    updateFromServer( dt, serverState ) {

        if ( ! serverState ) return;

        // Smoother lerp for remote players (lower = smoother)
        const lerpFactor = 1 - Math.exp( - 12 * dt );

        // Lerp position toward server target
        this.spherePos.x += ( serverState.sx - this.spherePos.x ) * lerpFactor;
        this.spherePos.y += ( serverState.sy - this.spherePos.y ) * lerpFactor;
        this.spherePos.z += ( serverState.sz - this.spherePos.z ) * lerpFactor;

        this.container.position.set(
            this.spherePos.x,
            this.spherePos.y,
            this.spherePos.z
        );

        // Slerp rotation toward server target
        _currQ.set( serverState.sqx, serverState.sqy, serverState.sqz, serverState.sqw );
        this.container.quaternion.slerp( _currQ, lerpFactor );

        // Lerp visual values to avoid snapping artifacts from 20Hz network updates
        const visualLerp = 1 - Math.exp( - 8 * dt );
        this.linearSpeed += ( serverState.linearSpeed - this.linearSpeed ) * visualLerp;
        this.acceleration += ( serverState.acceleration - this.acceleration ) * visualLerp;
        this.driftIntensity += ( serverState.driftIntensity - this.driftIntensity ) * visualLerp;
        this.inputX += ( serverState.inputX - this.inputX ) * visualLerp;
        this.inputZ += ( serverState.inputZ - this.inputZ ) * visualLerp;

        // Model velocity
        if ( dt > 0 ) {

            this.modelVelocity.subVectors( this.container.position, this.prevModelPos ).divideScalar( dt );
            this.prevModelPos.copy( this.container.position );

        }

        this.updateBody( dt );
        this.updateWheels( dt );

    }

    updateBody( dt ) {

        if ( ! this.bodyNode ) return;

        const targetPitch = THREE.MathUtils.clamp( -this.inputZ * 0.12, -0.15, 0.15 );
        const targetRoll = THREE.MathUtils.clamp( -( this.inputX / 5 ) * Math.min( Math.abs( this.linearSpeed ) / 5, 1 ), -0.2, 0.2 );

        this.bodyNode.rotation.x = lerpAngle( this.bodyNode.rotation.x, targetPitch, dt * 8 );
        this.bodyNode.rotation.z = lerpAngle( this.bodyNode.rotation.z, targetRoll, dt * 8 );

        this.bodyNode.position.y = THREE.MathUtils.lerp( this.bodyNode.position.y, 0.2, dt * 5 );

        // Brake lights: inputZ < 0 means braking
        if ( this._rearLights && this._headlightsOn ) {

            const braking = this.inputZ < -0.05;
            const target  = braking ? 4.0 : 0.8;
            this._rearIntensity += ( target - this._rearIntensity ) * ( 1 - Math.exp( -dt * 12 ) );

            for ( const pt of this._rearLights ) pt.intensity = this._rearIntensity;

            const bright = this._rearIntensity > 2.0;
            for ( const node of this._rearLightNodes ) {

                if ( node.isMesh ) node.material = bright ? this._rearMatOn : this._rearMatOff;

            }

        }

    }

    updateWheels( dt ) {

        for ( const wheel of this.wheels ) {

            wheel.rotation.x += this.acceleration;

        }

        if ( this.wheelFL ) {

            this.wheelFL.rotation.y = lerpAngle( this.wheelFL.rotation.y, -this.inputX / 1.5, dt * 10 );

        }

        if ( this.wheelFR ) {

            this.wheelFR.rotation.y = lerpAngle( this.wheelFR.rotation.y, -this.inputX / 1.5, dt * 10 );

        }

    }

    addHeadlights() {

        this._frontSpots = [];
        this._rearLights = [];

        this._frontMatOff = new THREE.MeshBasicMaterial( { color: 0x2a2e33 } );
        this._frontMatOn  = new THREE.MeshBasicMaterial( { color: 0xfff5cc } );
        this._rearMatOff  = new THREE.MeshBasicMaterial( { color: 0x2a0000 } );
        this._rearMatOn   = new THREE.MeshBasicMaterial( { color: 0xff2200 } );

        const frontNodes = this._frontLightNodes.length > 0
            ? this._frontLightNodes
            : _makeFallbackNodes( _FALLBACK_FRONT, this.container );

        for ( const node of frontNodes ) {

            const spot = new THREE.SpotLight( 0xfff5e0, 0, 18, Math.PI / 7, 0.4, 1.5 );
            const target = new THREE.Object3D();
            target.position.set( 0, -0.6, 8 );
            node.add( target );
            spot.target = target;
            node.add( spot );
            this._frontSpots.push( spot );

            if ( node.isMesh ) node.material = this._frontMatOff;

        }

        const rearNodes = this._rearLightNodes.length > 0
            ? this._rearLightNodes
            : _makeFallbackNodes( _FALLBACK_REAR, this.container );

        for ( const node of rearNodes ) {

            const pt = new THREE.PointLight( 0xff1500, 0, 3, 2 );
            node.add( pt );
            this._rearLights.push( pt );

            if ( node.isMesh ) node.material = this._rearMatOff;

        }

        this._headlightsOn = false;
        this._rearIntensity = 0;

    }

    setHeadlights( on ) {

        if ( ! this._frontSpots ) return;
        this._headlightsOn = on;

        for ( const spot of this._frontSpots ) spot.intensity = on ? 18 : 0;

        if ( ! on ) {

            this._rearIntensity = 0;
            for ( const pt of this._rearLights ) pt.intensity = 0;
            for ( const node of this._rearLightNodes ) {

                if ( node.isMesh ) node.material = this._rearMatOff;

            }

        }

        for ( const node of this._frontLightNodes ) {

            if ( node.isMesh ) node.material = on ? this._frontMatOn : this._frontMatOff;

        }

    }

    dispose( scene ) {

        scene.remove( this.container );

    }

}
