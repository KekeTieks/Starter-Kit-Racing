import * as THREE from 'three';
import { USE_ARCADE_VEHICLE } from './VehicleStats.js';

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

            }

            if ( child.isMesh ) {

                child.castShadow = true;
                child.receiveShadow = true;

            }

        } );

        return this.container;

    }

    updateFromServer( dt, serverState ) {

        if ( ! serverState ) return;

        // Smoother lerp for remote players (lower = smoother)
        const lerpFactor = 1 - Math.exp( - 12 * dt );

        // Lerp position toward server target
        this.spherePos.x += ( serverState.sx - this.spherePos.x ) * lerpFactor;
        this.spherePos.y += ( serverState.sy - this.spherePos.y ) * lerpFactor;
        this.spherePos.z += ( serverState.sz - this.spherePos.z ) * lerpFactor;

        const yOffset = USE_ARCADE_VEHICLE ? 0 : - 0.5;
        this.container.position.set(
            this.spherePos.x,
            this.spherePos.y + yOffset,
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

        if ( USE_ARCADE_VEHICLE ) {

            // In arcade mode, linearSpeed is in m/s (can reach ~10). Use inputZ to derive
            // a pitch that matches what the local arcade body produces (~±0.15 rad max).
            const targetPitch = THREE.MathUtils.clamp( -this.inputZ * 0.12, -0.15, 0.15 );
            const targetRoll = THREE.MathUtils.clamp( -( this.inputX / 5 ) * Math.min( Math.abs( this.linearSpeed ) / 5, 1 ), -0.2, 0.2 );

            this.bodyNode.rotation.x = lerpAngle( this.bodyNode.rotation.x, targetPitch, dt * 8 );
            this.bodyNode.rotation.z = lerpAngle( this.bodyNode.rotation.z, targetRoll, dt * 8 );

        } else {

            this.bodyNode.rotation.x = lerpAngle(
                this.bodyNode.rotation.x,
                -( this.linearSpeed - this.acceleration ) / 6,
                dt * 10
            );

            this.bodyNode.rotation.z = lerpAngle(
                this.bodyNode.rotation.z,
                -( this.inputX / 5 ) * this.linearSpeed,
                dt * 5
            );

        }

        this.bodyNode.position.y = THREE.MathUtils.lerp( this.bodyNode.position.y, 0.2, dt * 5 );

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

    dispose( scene ) {

        scene.remove( this.container );

    }

}
