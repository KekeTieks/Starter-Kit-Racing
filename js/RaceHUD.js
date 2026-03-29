import { gsap } from 'gsap';

export class RaceHUD {

    constructor() {

        this.container = document.getElementById( 'race-hud' );
        this.container.innerHTML = `
            <div id="hud-countdown" class="hud-countdown"></div>
            <div id="hud-lap" class="hud-lap"></div>
            <div id="hud-leaderboard" class="hud-leaderboard"></div>
            <div id="hud-nitro" class="hud-nitro">
                <div class="hud-nitro-label">NITRO</div>
                <div class="hud-nitro-track">
                    <div id="hud-nitro-fill" class="hud-nitro-fill"></div>
                </div>
            </div>
            <div id="hud-results" class="hud-results"></div>
        `;

        this.countdownEl = document.getElementById( 'hud-countdown' );
        this.lapEl = document.getElementById( 'hud-lap' );
        this.leaderboardEl = document.getElementById( 'hud-leaderboard' );
        this.resultsEl = document.getElementById( 'hud-results' );
        this.nitroFillEl = document.getElementById( 'hud-nitro-fill' );

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

        gsap.killTweensOf( this.countdownEl );

        const isGo = n <= 0;
        this.countdownEl.textContent = isGo ? 'GO!' : String( n );
        this.countdownEl.className = 'hud-countdown hud-countdown-active';

        if ( isGo ) {

            // GO! — punch in then fade out
            gsap.fromTo( this.countdownEl,
                { scale: 0.4, opacity: 0 },
                {
                    scale:    1,
                    opacity:  1,
                    duration: 0.25,
                    ease:     'back.out(2)',
                    onComplete: () => {

                        gsap.to( this.countdownEl, {
                            scale:    1.15,
                            opacity:  0,
                            duration: 0.5,
                            delay:    0.3,
                            ease:     'power2.in',
                            onComplete: () => {

                                this.countdownEl.className = 'hud-countdown';
                                this.countdownEl.textContent = '';
                                this.lastCountdown = -1;
                                gsap.set( this.countdownEl, { scale: 1, opacity: 1 } );

                            },
                        } );

                    },
                }
            );

        } else {

            // Number — scale punch + subtle shake
            gsap.fromTo( this.countdownEl,
                { scale: 1.6, opacity: 0 },
                { scale: 1, opacity: 1, duration: 0.3, ease: 'power3.out' }
            );

        }

    }

    hideCountdown() {

        gsap.killTweensOf( this.countdownEl );
        gsap.set( this.countdownEl, { scale: 1, opacity: 1 } );
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
                username: state.username || '',
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

            const label = escHtml( e.username || e.color );
            return `<div class="hud-lb-row">
                <span class="hud-lb-pos">${ pos }</span>
                <span class="hud-lb-color" style="--truck-color: ${ truckColor( e.color ) }">${ label }</span>
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
                username: state.username || '',
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
            const rankClass = e.finished
                ? ( e.finishPosition <= 3 ? ` rank-${ e.finishPosition }` : '' )
                : ' dnf';

            const label = escHtml( e.username || ( e.color + ' truck' ) );
            return `<div class="hud-result-row${ rankClass }">
                <span class="hud-result-pos">${ pos }</span>
                <span class="hud-result-color" style="--truck-color: ${ truckColor( e.color ) }">${ label }</span>
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
        gsap.fromTo( this.resultsEl.querySelector( '.hud-results-panel' ),
            { opacity: 0, y: 24, scale: 0.97 },
            { opacity: 1, y: 0,  scale: 1, duration: 0.4, ease: 'power3.out' }
        );

        if ( isHost && onPlayAgain ) {

            document.getElementById( 'hud-btn-play-again' ).addEventListener( 'click', onPlayAgain );

        }

        if ( onReturnToLobby ) {

            document.getElementById( 'hud-btn-return-lobby' ).addEventListener( 'click', onReturnToLobby );

        }

    }

    hideResults( animated = false ) {

        const panel = this.resultsEl.querySelector( '.hud-results-panel' );
        if ( animated && panel ) {

            gsap.to( panel, {
                opacity: 0, y: 16, scale: 0.97, duration: 0.25, ease: 'power2.in',
                onComplete: () => {
                    this.resultsEl.style.display = 'none';
                    this.resultsEl.innerHTML = '';
                }
            } );

        } else {

            this.resultsEl.style.display = 'none';
            this.resultsEl.innerHTML = '';

        }

    }

    hideAll() {

        this.hideCountdown();
        this.hideResults();
        this.lapEl.textContent = '';
        this.leaderboardEl.innerHTML = '';

    }

    // ─── Nitro gauge ────────────────────────────────────

    updateNitro( gauge, active ) {

        if ( ! this.nitroFillEl ) return;
        const pct = Math.round( gauge * 100 );
        this.nitroFillEl.style.width = pct + '%';
        this.nitroFillEl.classList.toggle( 'nitro-active', active );

    }

    showRewardToast( xpEarned, creditsEarned ) {

        const toast = document.createElement( 'div' );
        toast.className = 'hud-reward-toast';
        toast.innerHTML = `<span>+${ xpEarned } XP</span><span>+${ creditsEarned } credits</span>`;
        document.body.appendChild( toast );

        gsap.fromTo( toast,
            { opacity: 0, y: 20 },
            {
                opacity: 1, y: 0, duration: 0.4, ease: 'power3.out',
                onComplete: () => {
                    gsap.to( toast, {
                        opacity: 0, y: -16, delay: 2.5, duration: 0.4,
                        onComplete: () => toast.remove(),
                    } );
                },
            }
        );

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

function escHtml( str ) {

    return String( str )
        .replace( /&/g, '&amp;' )
        .replace( /</g, '&lt;' )
        .replace( />/g, '&gt;' );

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
