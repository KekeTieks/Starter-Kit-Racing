export class Lobby {

    constructor() {

        this.container = document.getElementById( 'lobby' );
        this.onPlayOnline = null;
        this.onPlayOffline = null;
        this.onJoinRoom = null;
        this.onStartRace = null;

        this.selectedMode = 'race';
        this.selectedLaps = 3;
        this.isHost = false;

        this.buildMenu();

    }

    buildMenu() {

        const params = new URLSearchParams( window.location.search );
        const roomId = params.get( 'room' );

        this.container.innerHTML = `
            <div class="lobby-panel">
                <h1>Racing</h1>
                <div class="lobby-buttons">
                    <button id="btn-online">${ roomId ? 'Join Room' : 'Play Online' }</button>
                    <button id="btn-offline">Play Offline</button>
                </div>
                <div id="lobby-status" class="lobby-status"></div>
                <div id="lobby-players" class="lobby-players"></div>
                <div id="lobby-room-info" class="lobby-room-info"></div>
                <div id="lobby-race-options" class="lobby-race-options" style="display:none">
                    <div class="mode-toggle">
                        <button id="btn-mode-race" class="mode-btn active">Race</button>
                        <button id="btn-mode-sandbox" class="mode-btn">Sandbox</button>
                    </div>
                    <div id="lap-selector" class="lap-selector">
                        <label>Laps</label>
                        <button id="btn-laps-minus" class="lap-btn">-</button>
                        <span id="lap-count">3</span>
                        <button id="btn-laps-plus" class="lap-btn">+</button>
                    </div>
                    <button id="btn-start" class="start-btn">Start</button>
                </div>
                <div id="lobby-guest-status" class="lobby-status" style="display:none">
                    Waiting for host to start...
                </div>
            </div>
        `;

        document.getElementById( 'btn-online' ).addEventListener( 'click', () => {

            if ( roomId && this.onJoinRoom ) {

                this.onJoinRoom( roomId );

            } else if ( this.onPlayOnline ) {

                this.onPlayOnline();

            }

        } );

        document.getElementById( 'btn-offline' ).addEventListener( 'click', () => {

            if ( this.onPlayOffline ) this.onPlayOffline();

        } );

        // Mode toggle
        document.getElementById( 'btn-mode-race' ).addEventListener( 'click', () => {

            this.selectedMode = 'race';
            document.getElementById( 'btn-mode-race' ).classList.add( 'active' );
            document.getElementById( 'btn-mode-sandbox' ).classList.remove( 'active' );
            document.getElementById( 'lap-selector' ).style.display = '';

        } );

        document.getElementById( 'btn-mode-sandbox' ).addEventListener( 'click', () => {

            this.selectedMode = 'sandbox';
            document.getElementById( 'btn-mode-sandbox' ).classList.add( 'active' );
            document.getElementById( 'btn-mode-race' ).classList.remove( 'active' );
            document.getElementById( 'lap-selector' ).style.display = 'none';

        } );

        // Lap count
        document.getElementById( 'btn-laps-minus' ).addEventListener( 'click', () => {

            this.selectedLaps = Math.max( 1, this.selectedLaps - 1 );
            document.getElementById( 'lap-count' ).textContent = this.selectedLaps;

        } );

        document.getElementById( 'btn-laps-plus' ).addEventListener( 'click', () => {

            this.selectedLaps = Math.min( 10, this.selectedLaps + 1 );
            document.getElementById( 'lap-count' ).textContent = this.selectedLaps;

        } );

        // Start button
        document.getElementById( 'btn-start' ).addEventListener( 'click', () => {

            if ( this.onStartRace ) {

                this.onStartRace( { mode: this.selectedMode, laps: this.selectedLaps } );

            }

        } );

    }

    showConnecting() {

        document.getElementById( 'lobby-status' ).textContent = 'Connecting...';
        document.getElementById( 'btn-online' ).disabled = true;
        document.getElementById( 'btn-offline' ).disabled = true;

    }

    showRoom( roomId, isHost ) {

        this.isHost = isHost;

        document.getElementById( 'lobby-status' ).textContent = 'Connected!';
        document.getElementById( 'btn-online' ).style.display = 'none';
        document.getElementById( 'btn-offline' ).style.display = 'none';

        const roomInfo = document.getElementById( 'lobby-room-info' );
        const shareUrl = new URL( window.location.href );
        shareUrl.searchParams.set( 'room', roomId );
        roomInfo.innerHTML = `
            <p>Share this link to invite players:</p>
            <input type="text" value="${ shareUrl.href }" readonly onclick="this.select()">
        `;

        if ( isHost ) {

            document.getElementById( 'lobby-race-options' ).style.display = '';

        } else {

            document.getElementById( 'lobby-guest-status' ).style.display = '';

        }

    }

    updatePlayers( players ) {

        const el = document.getElementById( 'lobby-players' );
        if ( ! el ) return;

        const items = players.map( ( p ) =>
            `<div class="player-badge" style="--color: ${ p.color }">${ p.color } truck</div>`
        ).join( '' );

        el.innerHTML = `<div class="player-list">${ items }</div>`;

    }

    showError( msg ) {

        document.getElementById( 'lobby-status' ).textContent = msg;
        const btnOnline = document.getElementById( 'btn-online' );
        const btnOffline = document.getElementById( 'btn-offline' );
        if ( btnOnline ) { btnOnline.disabled = false; btnOnline.style.display = ''; }
        if ( btnOffline ) { btnOffline.disabled = false; btnOffline.style.display = ''; }

        const raceOpts = document.getElementById( 'lobby-race-options' );
        if ( raceOpts ) raceOpts.style.display = 'none';
        const guestStatus = document.getElementById( 'lobby-guest-status' );
        if ( guestStatus ) guestStatus.style.display = 'none';

    }

    hide() {

        this.container.style.display = 'none';

    }

    show() {

        this.container.style.display = '';

    }

}
