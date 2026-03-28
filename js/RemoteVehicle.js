import * as THREE from 'three';

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

        this.spherePos = new THREE.Vector3();
        this.linearSpeed = 0;
        this.acceleration = 0;
        this.driftIntensity = 0;
        this.inputX = 0;

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

        this.container.position.set(
            this.spherePos.x,
            this.spherePos.y - 0.5,
            this.spherePos.z
        );

        // Slerp rotation toward server target
        _currQ.set( serverState.sqx, serverState.sqy, serverState.sqz, serverState.sqw );
        this.container.quaternion.slerp( _currQ, lerpFactor );

        // Use server values for visuals
        this.linearSpeed = serverState.linearSpeed;
        this.acceleration = serverState.acceleration;
        this.driftIntensity = serverState.driftIntensity;
        this.inputX = serverState.inputX;

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
