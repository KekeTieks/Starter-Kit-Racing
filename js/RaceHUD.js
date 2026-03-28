export class RaceHUD {

    constructor() {

        this.container = document.getElementById( 'race-hud' );
        this.container.innerHTML = `
            <div id="hud-countdown" class="hud-countdown"></div>
            <div id="hud-lap" class="hud-lap"></div>
            <div id="hud-leaderboard" class="hud-leaderboard"></div>
            <div id="hud-results" class="hud-results"></div>
        `;

        this.countdownEl = document.getElementById( 'hud-countdown' );
        this.lapEl = document.getElementById( 'hud-lap' );
        this.leaderboardEl = document.getElementById( 'hud-leaderboard' );
        this.resultsEl = document.getElementById( 'hud-results' );

        this.lastCountdown = -1;
        this.mode = 'sandbox';

    }

    setMode( mode ) {

        this.mode = mode;

    }

    // ─── Countdown ────────────────────────────────────────

    showCountdown( n ) {

        if ( n === this.lastCountdown ) return;
        this.lastCountdown = n;

        if ( n > 0 ) {

            this.countdownEl.textContent = n;
            this.countdownEl.className = 'hud-countdown hud-countdown-active';

            // Trigger reflow for animation restart
            void this.countdownEl.offsetWidth;
            this.countdownEl.classList.add( 'hud-countdown-pop' );

        } else {

            this.countdownEl.textContent = 'GO!';
            this.countdownEl.className = 'hud-countdown hud-countdown-active hud-countdown-pop';

            setTimeout( () => {

                this.countdownEl.className = 'hud-countdown';
                this.countdownEl.textContent = '';
                this.lastCountdown = -1;

            }, 800 );

        }

    }

    hideCountdown() {

        this.countdownEl.className = 'hud-countdown';
        this.countdownEl.textContent = '';
        this.lastCountdown = -1;

    }

    // ─── Lap display ──────────────────────────────────────

    updateLapDisplay( myState, totalLaps ) {

        if ( this.mode !== 'race' || ! myState ) {

            this.lapEl.textContent = '';
            return;

        }

        const lap = Math.min( myState.currentLap + 1, totalLaps );
        const lapTime = formatTime( myState.lapTime || 0 );
        const totalTime = formatTime( myState.totalTime || 0 );

        this.lapEl.innerHTML = `
            <div class="hud-lap-counter">Lap ${ lap }/${ totalLaps }</div>
            <div class="hud-lap-time">${ lapTime }</div>
            <div class="hud-total-time">${ totalTime }</div>
        `;

    }

    // ─── Leaderboard ──────────────────────────────────────

    updateLeaderboard( playerStates, totalLaps ) {

        if ( this.mode !== 'race' ) {

            this.leaderboardEl.innerHTML = '';
            return;

        }

        const entries = [];

        for ( const [ , state ] of playerStates ) {

            entries.push( {
                color: state.color,
                lap: state.currentLap || 0,
                lapTime: state.lapTime || 0,
                totalTime: state.totalTime || 0,
                finished: state.finished,
                finishPosition: state.finishPosition || 0,
                raceProgress: state.raceProgress || 0,
            } );

        }

        // Sort: finished players by finish position, then racing players by live progress desc
        entries.sort( ( a, b ) => {

            if ( a.finished && ! b.finished ) return -1;
            if ( ! a.finished && b.finished ) return 1;
            if ( a.finished && b.finished ) return a.finishPosition - b.finishPosition;
            return b.raceProgress - a.raceProgress;

        } );

        const rows = entries.map( ( e, i ) => {

            const pos = e.finished ? e.finishPosition : ( i + 1 );
            const status = e.finished
                ? formatTime( e.totalTime )
                : `Lap ${ Math.min( e.lap + 1, totalLaps ) }/${ totalLaps } — ${ formatTime( e.lapTime ) }`;

            return `<div class="hud-lb-row">
                <span class="hud-lb-pos">${ pos }</span>
                <span class="hud-lb-color" style="--truck-color: ${ truckColor( e.color ) }">${ e.color }</span>
                <span class="hud-lb-status">${ status }</span>
            </div>`;

        } ).join( '' );

        this.leaderboardEl.innerHTML = rows;

    }

    // ─── Results ──────────────────────────────────────────

    showResults( playerStates, isHost, onPlayAgain, onReturnToLobby ) {

        const entries = [];

        for ( const [ , state ] of playerStates ) {

            entries.push( {
                color: state.color,
                finishPosition: state.finishPosition || 0,
                totalTime: state.totalTime || 0,
                finished: state.finished,
            } );

        }

        entries.sort( ( a, b ) => {

            if ( a.finished && ! b.finished ) return -1;
            if ( ! a.finished && b.finished ) return 1;
            return a.finishPosition - b.finishPosition;

        } );

        const rows = entries.map( ( e ) => {

            const pos = e.finished ? `#${ e.finishPosition }` : 'DNF';
            const time = e.finished ? formatTime( e.totalTime ) : '--';

            return `<div class="hud-result-row">
                <span class="hud-result-pos">${ pos }</span>
                <span class="hud-result-color" style="--truck-color: ${ truckColor( e.color ) }">${ e.color } truck</span>
                <span class="hud-result-time">${ time }</span>
            </div>`;

        } ).join( '' );

        const hostBtn = isHost
            ? `<button id="hud-btn-play-again" class="hud-results-btn hud-results-btn-primary">Play Again</button>`
            : `<p class="hud-results-waiting">Waiting for host...</p>`;

        this.resultsEl.innerHTML = `
            <div class="hud-results-panel">
                <h2>Results</h2>
                ${ rows }
                <div class="hud-results-actions">
                    ${ hostBtn }
                    <button id="hud-btn-return-lobby" class="hud-results-btn">Return to Lobby</button>
                </div>
            </div>
        `;
        this.resultsEl.style.display = 'flex';

        if ( isHost && onPlayAgain ) {

            document.getElementById( 'hud-btn-play-again' ).addEventListener( 'click', onPlayAgain );

        }

        if ( onReturnToLobby ) {

            document.getElementById( 'hud-btn-return-lobby' ).addEventListener( 'click', onReturnToLobby );

        }

    }

    hideResults() {

        this.resultsEl.style.display = 'none';
        this.resultsEl.innerHTML = '';

    }

    hideAll() {

        this.hideCountdown();
        this.hideResults();
        this.lapEl.textContent = '';
        this.leaderboardEl.innerHTML = '';

    }

}

function formatTime( ms ) {

    const totalSec = Math.floor( ms / 1000 );
    const min = Math.floor( totalSec / 60 );
    const sec = totalSec % 60;
    const centis = Math.floor( ( ms % 1000 ) / 10 );

    if ( min > 0 ) {

        return `${ min }:${ String( sec ).padStart( 2, '0' ) }.${ String( centis ).padStart( 2, '0' ) }`;

    }

    return `${ sec }.${ String( centis ).padStart( 2, '0' ) }`;

}

function truckColor( name ) {

    const colors = {
        yellow: '#f5c542',
        green: '#4caf50',
        purple: '#9c27b0',
        red: '#f44336',
    };
    return colors[ name ] || '#fff';

}
