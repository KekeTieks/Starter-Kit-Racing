import { VEHICLE_STATS } from './VehicleStats.js';
import { loadCircuits, generateMinimap, deleteCircuit } from './CircuitLibrary.js';
import { VehicleCarousel, VEHICLE_KEYS } from './VehicleCarousel.js';
import { gsap } from 'gsap';
import { profileService } from './ProfileService.js';
import { upgradeService } from './UpgradeService.js';
import { UPGRADE_CONFIG, MAX_UPGRADE_LEVEL } from './UpgradeConfig.js';
import { cosmeticService } from './CosmeticService.js';
import { COSMETIC_SLOTS, getItemsForSlot, getItem } from './CosmeticConfig.js';

const LS_USERNAME = 'racing_username';
const LS_VEHICLE  = 'racing_vehicle';

function escHtml( str ) {

	return String( str )
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' )
		.replace( /"/g, '&quot;' );

}

const VEHICLE_NAMES = {
	yellow: 'Yellow Truck',
	green:  'Green Truck',
	purple: 'Purple Truck',
	red:    'Red Truck',
};

function statBars( value, max = 5 ) {

	let out = '';
	for ( let i = 0; i < max; i++ ) {

		out += `<span class="stat-dot${ i < value ? ' filled' : '' }"></span>`;

	}

	return out;

}

export class Lobby {

	constructor() {

		this.container = document.getElementById( 'lobby' );

		// Callbacks set by main.js
		this.onPlayOffline   = null;
		this.onPlayOnline    = null;
		this.onJoinByCode    = null;
		this.onStartRace     = null;
		this.onLeaveRoom     = null;
		this.onCircuitChange = null; // ( cells ) — host changed circuit in room lobby

		// Selections
		this.selectedUsername = localStorage.getItem( LS_USERNAME ) || '';
		this.selectedVehicle  = localStorage.getItem( LS_VEHICLE )  || 'yellow';
		this.selectedCells    = null;

		// Multiplayer room state
		this.selectedMode    = 'race';
		this.selectedLaps    = 3;
		this.selectedWeather = 'random';
		this.isHost          = false;

		this._buildIdentityScreen();

	}

	// ─── Public accessors ────────────────────────────────────────────────────

	getUsername()      { return this.selectedUsername; }
	getVehicle()       { return this.selectedVehicle; }
	getUpgrades()      { return upgradeService.getVehicleUpgrades( this.selectedVehicle ); }
	getSelectedCells() { return this.selectedCells; }
	getWeather()       { return this.selectedWeather; }

	// ─── Screen transition helper ────────────────────────────────────────────

	/**
	 * Fade-out current content, run builder(), fade-in new content.
	 * @param {Function} builder  — synchronous fn that sets this.container.innerHTML
	 * @param {string}   dir      — 'forward' | 'back'  (slide direction)
	 */
	_transition( builder, dir = 'forward' ) {

		const xOut = dir === 'forward' ? '-30px' : '30px';
		const xIn  = dir === 'forward' ? '30px'  : '-30px';

		const current = this.container.firstElementChild;

		if ( current ) {

			gsap.to( current, {
				opacity:  0,
				x:        xOut,
				duration: 0.18,
				ease:     'power2.in',
				onComplete: () => {

					builder();
					const next = this.container.firstElementChild;
					if ( next ) {

						gsap.fromTo( next,
							{ opacity: 0, x: xIn },
							{ opacity: 1, x: 0, duration: 0.22, ease: 'power2.out' }
						);

					}

				},
			} );

		} else {

			builder();
			const next = this.container.firstElementChild;
			if ( next ) {

				gsap.fromTo( next,
					{ opacity: 0, x: xIn },
					{ opacity: 1, x: 0, duration: 0.22, ease: 'power2.out' }
				);

			}

		}

	}

	// ─── Screen 1 : Identity (username only) ────────────────────────────────

	_buildIdentityScreen() {

		// If already logged in, skip straight to mode screen (refresh profile first)
		if ( profileService.isLoggedIn() ) {

			this.selectedUsername = profileService.username;
			profileService.refresh().then( () => this._buildModeScreen() );
			return;

		}

		const savedName = this.selectedUsername;

		this.container.innerHTML = `
			<div class="lobby-panel lobby-panel--narrow">
				<h1>MY RACE</h1>
				<div class="lobby-section">
					<label class="lobby-label" for="username-input">Pseudo</label>
					<input id="username-input" class="username-input" type="text" maxlength="20"
						placeholder="Ton nom..." value="${ escHtml( savedName ) }" autocomplete="off">
				</div>
				<div id="identity-status" class="lobby-status" style="min-height:20px"></div>
				<button id="btn-continue" class="primary-btn"${ savedName ? '' : ' disabled' }>Continuer →</button>
			</div>`;

		const input     = document.getElementById( 'username-input' );
		const btnContinue = document.getElementById( 'btn-continue' );
		const statusEl  = document.getElementById( 'identity-status' );

		const setStatus = ( msg, isError = false ) => {

			statusEl.textContent = msg;
			statusEl.style.color = isError ? '#f87171' : 'rgba(255,255,255,0.5)';

		};

		input.addEventListener( 'input', () => {

			btnContinue.disabled = input.value.trim().length === 0;
			setStatus( '' );

		} );

		input.addEventListener( 'keydown', ( e ) => { if ( e.key === 'Enter' ) btnContinue.click(); } );

		btnContinue.addEventListener( 'click', async () => {

			const val = input.value.trim();
			if ( ! val ) return;

			btnContinue.disabled = true;
			setStatus( 'Connexion...' );

			// Try login first, then register
			let result = await profileService.login( val );

			if ( ! result.ok && result.error === 'Player not found' ) {

				setStatus( 'Nouveau joueur, création du compte...' );
				result = await profileService.register( val );

			}

			if ( ! result.ok ) {

				setStatus( result.error, true );
				btnContinue.disabled = false;
				return;

			}

			this.selectedUsername = profileService.username;
			localStorage.setItem( LS_USERNAME, this.selectedUsername );

			// Load upgrades and cosmetics from server in background (non-blocking)
			upgradeService.loadFromServer( this.selectedUsername );
			cosmeticService.loadFromServer( this.selectedUsername );

			this._transition( () => this._buildModeScreen() );

		} );

	}

	// ─── Screen 2 : Mode selection (offline / create / join) ─────────────────

	_buildModeScreen() {

		const v         = this.selectedVehicle;
		const COLOR_HEX = { yellow: '#f5c842', green: '#4fcf6a', purple: '#a855f7', red: '#ef4444' };
		const dotColor  = COLOR_HEX[ v ] || '#fff';
		const stats     = VEHICLE_STATS[ v ];

		const p           = profileService.profile;
		const level       = p?.level         ?? 1;
		const xpThisLevel = p?.xp_this_level ?? 0;
		const xpForNext   = p?.xp_for_next   ?? 141;
		const credits     = p?.credits       ?? 0;
		const racesPlayed = p?.races_played  ?? 0;
		const wins        = p?.wins          ?? 0;
		const xpPct       = Math.min( 100, Math.round( ( xpThisLevel / xpForNext ) * 100 ) );

		this.container.classList.add( 'ms-fullscreen' );

		this.container.innerHTML = `
			<div class="ms-screen">

				<!-- ── Left: player hero ── -->
				<div class="ms-left">

					<div class="ms-bg-glow" style="--accent:${ dotColor }"></div>

					<div class="ms-player-hero">

						<div class="ms-avatar">
							<div class="ms-avatar-ring" style="--accent:${ dotColor }"></div>
							<span class="ms-avatar-level">${ level }</span>
							<span class="ms-avatar-label">NIV.</span>
						</div>

						<div class="ms-player-name">${ escHtml( this.selectedUsername ) }</div>

						<div class="ms-xp-block">
							<div class="ms-xp-header">
								<span class="ms-xp-title">XP</span>
								<span class="ms-xp-values">${ xpThisLevel.toLocaleString() } / ${ xpForNext.toLocaleString() }</span>
							</div>
							<div class="ms-xp-track">
								<div class="ms-xp-fill" style="width:0%"></div>
							</div>
						</div>

						<div class="ms-stats-row">
							<div class="ms-stat-pill">
								<span class="ms-stat-pill-val">${ credits.toLocaleString() }</span>
								<span class="ms-stat-pill-label">Crédits</span>
							</div>
							<div class="ms-stat-pill">
								<span class="ms-stat-pill-val">${ racesPlayed }</span>
								<span class="ms-stat-pill-label">Courses</span>
							</div>
							<div class="ms-stat-pill">
								<span class="ms-stat-pill-val">${ wins }</span>
								<span class="ms-stat-pill-label">Victoires</span>
							</div>
						</div>

						<button id="btn-vehicle" class="ms-vehicle-btn">
							<div class="ms-vehicle-dot" style="background:${ dotColor }"></div>
							<div class="ms-vehicle-info">
								<span class="ms-vehicle-name">${ VEHICLE_NAMES[ v ] }</span>
								<span class="ms-vehicle-stats">
									Vit. ${ statBars( stats.display.speed ) } &nbsp;
									Man. ${ statBars( stats.display.handling ) } &nbsp;
									Acc. ${ statBars( stats.display.acceleration ) }
								</span>
							</div>
							<span class="ms-vehicle-caret">→</span>
						</button>

					</div>

				</div>

				<!-- ── Right: play actions ── -->
				<div class="ms-right">

					<div class="ms-right-inner">

						<button id="btn-back" class="ms-back-btn">← Retour</button>

						<h2 class="ms-right-title">Choisir le mode</h2>

						<div class="ms-mode-cards">
							<button class="ms-mode-card" id="btn-offline">
								<span class="ms-mode-icon">🏁</span>
								<span class="ms-mode-title">Hors-ligne</span>
								<span class="ms-mode-desc">Solo, sans connexion</span>
							</button>
							<button class="ms-mode-card" id="btn-create">
								<span class="ms-mode-icon">🌐</span>
								<span class="ms-mode-title">Créer une room</span>
								<span class="ms-mode-desc">Invitez des amis avec un code</span>
							</button>
							<button class="ms-mode-card ms-mode-card--secondary" id="btn-editor">
								<span class="ms-mode-icon">✏️</span>
								<span class="ms-mode-title">Éditeur de circuit</span>
								<span class="ms-mode-desc">Dessine et teste tes propres circuits</span>
							</button>
						</div>

						<div class="ms-divider"></div>

						<div class="ms-join-section">
							<div class="ms-join-label">Rejoindre avec un code</div>
							<div class="ms-join-row">
								<input id="join-code-input" class="join-code-input" type="text" maxlength="4"
									placeholder="ABCD" autocomplete="off" spellcheck="false">
								<button id="btn-join-code" class="primary-btn">Rejoindre →</button>
							</div>
							<div id="join-code-status" class="lobby-status"></div>
						</div>

					</div>

				</div>

			</div>`;

		// Animate XP bar
		requestAnimationFrame( () => {

			const fill = document.querySelector( '.ms-xp-fill' );
			if ( fill ) gsap.to( fill, { width: `${ xpPct }%`, duration: 0.8, ease: 'power2.out', delay: 0.2 } );

		} );

		document.getElementById( 'btn-back' ).addEventListener( 'click', () => {

			this.container.classList.remove( 'ms-fullscreen' );
			this._transition( () => this._buildIdentityScreen(), 'back' );

		} );

		document.getElementById( 'btn-vehicle' ).addEventListener( 'click', () => {

			this.container.classList.remove( 'ms-fullscreen' );
			profileService.refresh().then( () => this._transition( () => this._buildVehicleCarouselScreen() ) );

		} );

		document.getElementById( 'btn-offline' ).addEventListener( 'click', () => {

			this.container.classList.remove( 'ms-fullscreen' );
			this._transition( () => this._buildCircuitScreen() );

		} );

		document.getElementById( 'btn-create' ).addEventListener( 'click', () => {

			if ( this.onPlayOnline ) this.onPlayOnline();

		} );

		document.getElementById( 'btn-editor' ).addEventListener( 'click', () => {

			window.open( 'editor.html', '_blank' );

		} );

		const joinCodeInput = document.getElementById( 'join-code-input' );
		const btnJoinCode   = document.getElementById( 'btn-join-code' );

		joinCodeInput.addEventListener( 'input', () => {

			joinCodeInput.value = joinCodeInput.value.toUpperCase().replace( /[^A-Z]/g, '' );

		} );

		const doJoin = () => {

			const code = joinCodeInput.value.trim();
			if ( code.length !== 4 ) return;
			if ( this.onJoinByCode ) this.onJoinByCode( code );

		};

		btnJoinCode.addEventListener( 'click', doJoin );
		joinCodeInput.addEventListener( 'keydown', ( e ) => { if ( e.key === 'Enter' ) doJoin(); } );

	}

	// ─── Screen : Vehicle carousel ───────────────────────────────────────────

	_buildVehicleCarouselScreen() {

		if ( this._carousel ) { this._carousel.dispose(); this._carousel = null; }

		// Switch #lobby to full-screen mode (removes centering padding)
		this.container.classList.add( 'vc-fullscreen' );

		const keys     = VEHICLE_KEYS;
		const COLOR_HEX = { yellow: '#f5c842', green: '#4fcf6a', purple: '#a855f7', red: '#ef4444' };
		let   idx      = keys.indexOf( this.selectedVehicle );
		if ( idx < 0 ) idx = 0;

		const statRow = ( label, val, max = 5 ) => `
			<div class="vc-stat-row">
				<div class="vc-stat-header">
					<span class="vc-stat-label">${ label }</span>
					<span class="vc-stat-val">${ val }/${ max }</span>
				</div>
				<div class="vc-stat-track">
					<div class="vc-stat-fill" style="width:${ Math.min( ( val / max ) * 100, 100 ) }%"></div>
				</div>
			</div>`;

		let activeTab = 'upgrades';

		const renderUpgradesSection = ( key ) => {

			const credits = profileService.credits;
			const rows = UPGRADE_CONFIG.map( ( def ) => {

				const level    = upgradeService.getLevel( key, def.id );
				const maxed    = level >= MAX_UPGRADE_LEVEL;
				const cost     = maxed ? null : def.levels[ level ].cost;
				const canAfford = cost !== null && credits >= cost;

				const pips = Array.from( { length: MAX_UPGRADE_LEVEL }, ( _, i ) =>
					`<span class="upg-pip${ i < level ? ' filled' : '' }"></span>`
				).join( '' );

				const btnLabel = maxed ? 'MAX' : `${ cost } cr`;
				const btnDisabled = maxed || ! canAfford ? 'disabled' : '';

				return `
					<div class="upg-row" data-upgrade="${ escHtml( def.id ) }">
						<span class="upg-icon">${ def.icon }</span>
						<div class="upg-info">
							<div class="upg-name-line">
								<span class="upg-name">${ escHtml( def.name ) }</span>
								<span class="upg-level">${ level }/${ MAX_UPGRADE_LEVEL }</span>
							</div>
							<div class="upg-pips">${ pips }</div>
						</div>
						<button class="upg-buy-btn${ maxed ? ' upg-buy-btn--maxed' : '' }" data-id="${ escHtml( def.id ) }" ${ btnDisabled }>${ btnLabel }</button>
					</div>`;

			} ).join( '' );

			return `
				<div class="vc-upgrades-section" id="vc-upgrades">
					<div class="upg-header">
						<span>AMÉLIORATIONS</span>
						<span class="upg-credits" id="upg-credits">${ credits } cr</span>
					</div>
					${ rows }
				</div>`;

		};

		const renderCosmeticsSection = ( key ) => {

			const credits = profileService.credits;
			const playerLevel = profileService.level;

			const slotBlocks = COSMETIC_SLOTS.map( ( slot ) => {

				const items = getItemsForSlot( slot.id );
				const equipped = cosmeticService.getEquipped( key, slot.id );

				const itemRows = items.map( ( item ) => {

					const owned = cosmeticService.isOwned( item.id );
					const isEquipped = equipped === item.id;
					const canAfford = credits >= item.cost;
					const levelOk = playerLevel >= ( item.requiredLevel || 1 );

					let btnHtml;
					if ( isEquipped ) {

						btnHtml = `<button class="cos-btn cos-btn--equipped" data-item="${ escHtml( item.id ) }" data-slot="${ escHtml( slot.id ) }">Équipé</button>`;

					} else if ( owned ) {

						btnHtml = `<button class="cos-btn cos-btn--equip" data-item="${ escHtml( item.id ) }" data-slot="${ escHtml( slot.id ) }">Équiper</button>`;

					} else if ( ! levelOk ) {

						btnHtml = `<button class="cos-btn" disabled>Niv.${ item.requiredLevel }</button>`;

					} else if ( ! canAfford ) {

						btnHtml = `<button class="cos-btn" disabled>${ item.cost } cr</button>`;

					} else {

						btnHtml = `<button class="cos-btn cos-btn--buy" data-item="${ escHtml( item.id ) }" data-slot="${ escHtml( slot.id ) }">${ item.cost } cr</button>`;

					}

					return `
						<div class="cos-item${ isEquipped ? ' cos-item--active' : '' }">
							<span class="cos-item-name">${ escHtml( item.name ) }</span>
							${ btnHtml }
						</div>`;

				} ).join( '' );

				const hasEquipped = equipped !== null;
				const unequipBtn = hasEquipped
					? `<button class="cos-unequip" data-slot="${ escHtml( slot.id ) }">Retirer</button>`
					: '';

				return `
					<div class="cos-slot">
						<div class="cos-slot-header">
							<span class="cos-slot-icon">${ slot.icon }</span>
							<span class="cos-slot-name">${ escHtml( slot.name ) }</span>
							${ unequipBtn }
						</div>
						<div class="cos-items">${ itemRows }</div>
					</div>`;

			} ).join( '' );

			return `
				<div class="vc-cosmetics-section" id="vc-cosmetics">
					<div class="upg-header">
						<span>COSMÉTIQUES</span>
						<span class="upg-credits">${ credits } cr</span>
					</div>
					${ slotBlocks }
				</div>`;

		};

		const renderTabs = () => `
			<div class="vc-tabs" id="vc-tabs">
				<button class="vc-tab${ activeTab === 'upgrades'  ? ' vc-tab--active' : '' }" data-tab="upgrades">Améliorations</button>
				<button class="vc-tab${ activeTab === 'cosmetics' ? ' vc-tab--active' : '' }" data-tab="cosmetics">Cosmétiques</button>
			</div>`;

		const key     = keys[ idx ];
		const display = upgradeService.getDisplayStats( key );

		this.container.innerHTML = `
			<div class="vc-screen">

				<!-- Left: 3D stage -->
				<div class="vc-left">
					<div class="vc-topbar">
						<button id="vc-btn-back" class="back-btn">← Retour</button>
						<span class="vc-title">Choisir un véhicule</span>
						<div></div>
					</div>

					<div class="vc-canvas-wrap" id="vc-canvas-wrap">
						<button id="vc-btn-prev" class="vc-nav-btn vc-nav-prev">&#8249;</button>
						<button id="vc-btn-next" class="vc-nav-btn vc-nav-next">&#8250;</button>
						<div class="vc-dots" id="vc-dots">
							${ keys.map( ( k, i ) =>
								`<div class="vc-dot${ i === idx ? ' active' : '' }"
									style="${ i === idx ? `background:${ COLOR_HEX[ k ] }` : '' }"
									data-i="${ i }"></div>`
							).join( '' ) }
						</div>
					</div>
				</div>

				<!-- Right: info panel -->
				<div class="vc-right" id="vc-right">
					<div>
						<div class="vc-vehicle-name" id="vc-name">${ VEHICLE_NAMES[ key ] }</div>
						<div class="vc-divider"></div>
					</div>
					<div class="vc-stats" id="vc-stats">
						${ statRow( 'Vitesse',      +display.speed.toFixed( 1 ), 7 ) }
						${ statRow( 'Maniabilité',  +display.handling.toFixed( 1 ), 7 ) }
						${ statRow( 'Accélération', +display.acceleration.toFixed( 1 ), 7 ) }
					</div>
					${ renderTabs() }
					<div class="vc-tab-content" id="vc-tab-content">
						${ activeTab === 'upgrades' ? renderUpgradesSection( key ) : renderCosmeticsSection( key ) }
					</div>
					<button id="vc-btn-select" class="vc-select-btn">
						Choisir ce véhicule
					</button>
				</div>

			</div>`;

		// Mount renderer inside canvas wrap
		const wrap = document.getElementById( 'vc-canvas-wrap' );
		this._carousel = new VehicleCarousel( wrap, key );
		this._carousel.applyLoadout( cosmeticService.getLoadout( key ) );

		// Bind upgrade purchase buttons for a given vehicle key
		const bindUpgradeButtons = ( vehicleKey ) => {

			document.querySelectorAll( '.upg-buy-btn:not([disabled])' ).forEach( ( btn ) => {

				btn.addEventListener( 'click', async () => {

					const upgradeId = btn.dataset.id;
					btn.disabled = true;
					btn.textContent = '…';

					const username = profileService.username;
					if ( ! username ) {
						btn.disabled = false;
						btn.textContent = 'Non connecté';
						return;
					}

					const result = await upgradeService.purchase( username, vehicleKey, upgradeId );

					if ( result.ok ) {

						profileService.applyCredits( result.newCredits );

					} else {

						// Show error briefly before re-render
						btn.textContent = result.error || 'Erreur';
						await new Promise( ( r ) => setTimeout( r, 1200 ) );

					}

					renderInfo( vehicleKey );

				} );

			} );

		};

		// Bind cosmetic buttons (buy / equip / unequip)
		const bindCosmeticButtons = ( vehicleKey ) => {

			// Buy buttons
			document.querySelectorAll( '.cos-btn--buy' ).forEach( ( btn ) => {

				btn.addEventListener( 'click', async () => {

					const itemId = btn.dataset.item;
					btn.disabled = true;
					btn.textContent = '…';

					const username = profileService.username;
					if ( ! username ) { btn.textContent = 'Non connecté'; return; }

					const result = await cosmeticService.purchase( username, itemId );

					if ( result.ok ) {

						profileService.applyCredits( result.newCredits );

					} else {

						btn.textContent = result.error || 'Erreur';
						await new Promise( ( r ) => setTimeout( r, 1200 ) );

					}

					renderInfo( vehicleKey );

				} );

			} );

			// Equip buttons
			document.querySelectorAll( '.cos-btn--equip' ).forEach( ( btn ) => {

				btn.addEventListener( 'click', async () => {

					const itemId = btn.dataset.item;
					const slotId = btn.dataset.slot;
					btn.disabled = true;
					btn.textContent = '…';

					const username = profileService.username;
					if ( ! username ) { btn.textContent = 'Non connecté'; return; }

					await cosmeticService.equipOnServer( username, vehicleKey, slotId, itemId );
					renderInfo( vehicleKey );

				} );

			} );

			// Equipped → unequip on click
			document.querySelectorAll( '.cos-btn--equipped' ).forEach( ( btn ) => {

				btn.addEventListener( 'click', async () => {

					const slotId = btn.dataset.slot;
					btn.disabled = true;
					btn.textContent = '…';

					const username = profileService.username;
					if ( ! username ) return;

					await cosmeticService.equipOnServer( username, vehicleKey, slotId, null );
					renderInfo( vehicleKey );

				} );

			} );

			// Unequip (slot-level "Retirer" button)
			document.querySelectorAll( '.cos-unequip' ).forEach( ( btn ) => {

				btn.addEventListener( 'click', async () => {

					const slotId = btn.dataset.slot;
					const username = profileService.username;
					if ( ! username ) return;

					await cosmeticService.equipOnServer( username, vehicleKey, slotId, null );
					renderInfo( vehicleKey );

				} );

			} );

		};

		const renderTabContent = ( key ) => {

			const contentEl = document.getElementById( 'vc-tab-content' );
			if ( ! contentEl ) return;

			if ( activeTab === 'upgrades' ) {

				contentEl.innerHTML = renderUpgradesSection( key );
				bindUpgradeButtons( key );

			} else {

				contentEl.innerHTML = renderCosmeticsSection( key );
				bindCosmeticButtons( key );

			}

		};

		const bindTabs = () => {

			document.querySelectorAll( '.vc-tab' ).forEach( ( tab ) => {

				tab.addEventListener( 'click', () => {

					activeTab = tab.dataset.tab;
					// Update active tab style
					document.querySelectorAll( '.vc-tab' ).forEach( ( t ) =>
						t.classList.toggle( 'vc-tab--active', t.dataset.tab === activeTab )
					);
					renderTabContent( keys[ idx ] );

				} );

			} );

		};

		// renderInfo must be declared after bind functions (used inside them)
		const renderInfo = ( key ) => {

			const display = upgradeService.getDisplayStats( key );
			const nameEl  = document.getElementById( 'vc-name' );
			const statsEl = document.getElementById( 'vc-stats' );
			const dotsEl  = document.getElementById( 'vc-dots' );

			if ( nameEl )  nameEl.textContent = VEHICLE_NAMES[ key ];
			if ( statsEl ) statsEl.innerHTML  =
				statRow( 'Vitesse',       +display.speed.toFixed( 1 ), 7 ) +
				statRow( 'Maniabilité',   +display.handling.toFixed( 1 ), 7 ) +
				statRow( 'Accélération',  +display.acceleration.toFixed( 1 ), 7 );

			if ( dotsEl ) {

				dotsEl.querySelectorAll( '.vc-dot' ).forEach( ( d, i ) => {

					const active = i === idx;
					d.classList.toggle( 'active', active );
					d.style.background = active ? COLOR_HEX[ keys[ i ] ] : '';

				} );

			}

			// Refresh tab content (upgrades or cosmetics)
			renderTabContent( key );

			// Update 3D preview with current cosmetics
			if ( this._carousel ) {

				this._carousel.applyLoadout( cosmeticService.getLoadout( key ) );

			}

		};

		// Nav
		const navigate = ( delta ) => {

			idx = ( ( idx + delta ) % keys.length + keys.length ) % keys.length;
			renderInfo( keys[ idx ] );
			this._carousel.setVehicle( keys[ idx ] );

		};

		// Bind initial tab content
		bindTabs();
		if ( activeTab === 'upgrades' ) bindUpgradeButtons( key );
		else bindCosmeticButtons( key );

		document.getElementById( 'vc-btn-back' ).addEventListener( 'click', () => {

			this._leaveCarousel();
			this._transition( () => this._buildModeScreen(), 'back' );

		} );

		document.getElementById( 'vc-btn-prev' ).addEventListener( 'click', () => navigate( -1 ) );
		document.getElementById( 'vc-btn-next' ).addEventListener( 'click', () => navigate( 1 ) );

		document.getElementById( 'vc-dots' ).querySelectorAll( '.vc-dot' ).forEach( ( d ) => {

			d.addEventListener( 'click', () => {

				idx = parseInt( d.dataset.i, 10 );
				renderInfo( keys[ idx ] );
				this._carousel.setVehicle( keys[ idx ] );

			} );

		} );

		document.getElementById( 'vc-btn-select' ).addEventListener( 'click', () => {

			this.selectedVehicle = keys[ idx ];
			localStorage.setItem( LS_VEHICLE, keys[ idx ] );

			// Flash the button before transitioning
			gsap.to( '#vc-btn-select', {
				scale:    0.96,
				duration: 0.1,
				yoyo:     true,
				repeat:   1,
				onComplete: () => {

					this._leaveCarousel();
					this._transition( () => this._buildModeScreen(), 'back' );

				},
			} );

		} );

		// Swipe on canvas
		let touchStartX = null;
		wrap.addEventListener( 'touchstart', ( e ) => { touchStartX = e.touches[ 0 ].clientX; }, { passive: true } );
		wrap.addEventListener( 'touchend', ( e ) => {

			if ( touchStartX === null ) return;
			const dx = e.changedTouches[ 0 ].clientX - touchStartX;
			touchStartX = null;
			if ( Math.abs( dx ) < 40 ) return;
			navigate( dx < 0 ? 1 : -1 );

		} );

	}

	_leaveCarousel() {

		if ( this._carousel ) { this._carousel.dispose(); this._carousel = null; }
		this.container.classList.remove( 'vc-fullscreen' );

	}

	// ─── Screen 3 : Circuit selection (offline only) ─────────────────────────

	_buildCircuitScreen() {

		const circuits = loadCircuits();

		const cards = circuits.map( ( circuit ) => {

			const minimap = generateMinimap( circuit.cells, 72 );
			const deleteBtnHtml = circuit.builtin ? '' :
				`<button class="circuit-delete-btn" data-id="${ circuit.id }" title="Supprimer">✕</button>`;

			return `
				<div class="circuit-card" data-id="${ circuit.id }">
					${ deleteBtnHtml }
					<div class="circuit-minimap">${ minimap }</div>
					<div class="circuit-name">${ escHtml( circuit.name ) }</div>
				</div>`;

		} ).join( '' );

		const btnLabel = 'Jouer hors-ligne';

		this.container.innerHTML = `
			<div class="lobby-panel">
				<div class="lobby-header-row">
					<button id="btn-back" class="back-btn">← Retour</button>
					<h1>Choisir un circuit</h1>
				</div>
				<div class="circuit-grid">${ cards }</div>
				<div id="circuit-status" class="lobby-status"></div>
				<div id="circuit-actions" style="display:none">
					<button id="btn-confirm" class="primary-btn">${ btnLabel }</button>
				</div>
			</div>`;

		if ( circuits.length > 0 ) {

			this._selectCircuit( circuits[ 0 ] );

		}

		this.container.querySelectorAll( '.circuit-card' ).forEach( ( card ) => {

			card.addEventListener( 'click', ( e ) => {

				if ( e.target.classList.contains( 'circuit-delete-btn' ) ) return;
				const id = card.dataset.id;
				const circuit = circuits.find( ( c ) => c.id === id );
				if ( circuit ) this._selectCircuit( circuit, card );

			} );

		} );

		this.container.querySelectorAll( '.circuit-delete-btn' ).forEach( ( btn ) => {

			btn.addEventListener( 'click', ( e ) => {

				e.stopPropagation();
				const id = btn.dataset.id;
				if ( confirm( 'Supprimer ce circuit ?' ) ) {

					deleteCircuit( id );
					this._buildCircuitScreen();

				}

			} );

		} );

		document.getElementById( 'btn-back' ).addEventListener( 'click', () => this._transition( () => this._buildModeScreen(), 'back' ) );

		document.getElementById( 'btn-confirm' ).addEventListener( 'click', () => {

			if ( this.onPlayOffline ) this.onPlayOffline();

		} );

	}

	_selectCircuit( circuit, cardEl ) {

		this.selectedCells = circuit.cells;
		this._selectedCircuitName = circuit.name;

		this.container.querySelectorAll( '.circuit-card' ).forEach( ( c ) => c.classList.remove( 'active' ) );

		if ( cardEl ) {

			cardEl.classList.add( 'active' );

		} else {

			const found = this.container.querySelector( `[data-id="${ circuit.id }"]` );
			if ( found ) found.classList.add( 'active' );

		}

		const actionsEl = document.getElementById( 'circuit-actions' );
		if ( actionsEl ) actionsEl.style.display = '';

		const statusEl = document.getElementById( 'circuit-status' );
		if ( statusEl ) statusEl.textContent = '';

	}

	// ─── Connecting state ─────────────────────────────────────────────────────

	showConnecting() {

		// Disable buttons in mode screen
		[ 'btn-create', 'btn-offline', 'btn-join-code', 'btn-confirm' ].forEach( ( id ) => {

			const el = document.getElementById( id );
			if ( el ) el.disabled = true;

		} );

		// Inject a fullscreen overlay spinner on top of whatever screen is visible
		const existing = document.getElementById( 'connecting-overlay' );
		if ( existing ) return;

		const overlay = document.createElement( 'div' );
		overlay.id = 'connecting-overlay';
		overlay.innerHTML = `
			<div class="conn-spinner"></div>
			<div class="conn-label">Connexion en cours…</div>`;
		this.container.appendChild( overlay );
		gsap.fromTo( overlay, { opacity: 0 }, { opacity: 1, duration: 0.2 } );

	}

	_removeConnectingOverlay() {

		const overlay = document.getElementById( 'connecting-overlay' );
		if ( overlay ) overlay.remove();

	}

	_enableModeButtons() {

		[ 'btn-create', 'btn-offline', 'btn-join-code', 'btn-confirm' ].forEach( ( id ) => {

			const el = document.getElementById( id );
			if ( el ) el.disabled = false;

		} );

	}

	// ─── Screen 4 : Multiplayer room lobby ────────────────────────────────────

	showRoom( _roomId, isHost, roomCode ) {

		this.isHost = isHost;
		this._roomCode = roomCode;

		this._removeConnectingOverlay();
		this.container.classList.remove( 'ms-fullscreen' );
		this.container.classList.add( 'room-fullscreen' );
		this._transition( () => {

			this._renderRoomLobby();
			// Players list is populated after DOM is ready
			if ( this._pendingPlayers ) {

				this.updatePlayers( this._pendingPlayers );
				this._pendingPlayers = null;

			}

		} );

	}

	_leaveRoom() {

		this.container.classList.remove( 'room-fullscreen' );

	}

	_renderRoomLobby() {

		const isHost = this.isHost;
		const roomCode = this._roomCode;

		const circuitMinimap = this.selectedCells ? generateMinimap( this.selectedCells, 52 ) : '';
		const circuitName = this._selectedCircuitName || 'Aucun circuit';

		this.container.innerHTML = `
			<div class="room-lobby">
				<div class="room-topbar">
					<button id="btn-leave-room" class="back-btn">← Quitter</button>
					<div class="room-title">MY RACE</div>
					${ roomCode ? `
					<div class="room-code-pill">
						<span class="room-code-pill-label">Code</span>
						<span class="room-code-pill-value">${ escHtml( roomCode ) }</span>
					</div>` : '' }
					<div class="room-player-self">
						<span class="room-badge ${ isHost ? 'host' : 'client' }">${ isHost ? 'Host' : 'Joueur' }</span>
						<span class="room-self-name">${ escHtml( this.selectedUsername ) }</span>
					</div>
				</div>
				<div class="room-body">
					<div class="room-panel">
						<div class="room-panel-header">Joueurs <span id="room-player-count"></span></div>
						<div id="lobby-players" class="room-players-list"></div>
					</div>
					<div class="room-panel">
						<div class="room-panel-header">Configuration</div>
						<div class="room-config ${ isHost ? '' : 'room-config-locked' }">
							<div class="room-config-row">
								<div class="room-config-label">Circuit</div>
								<div class="room-circuit-preview ${ isHost ? 'room-circuit-clickable' : '' }" id="btn-change-circuit">
									<div class="room-circuit-minimap">${ circuitMinimap }</div>
									<div class="room-circuit-info">
										<div class="room-circuit-name">${ escHtml( circuitName ) }</div>
										${ isHost ? `<div class="room-circuit-change">Changer →</div>` : '' }
									</div>
								</div>
							</div>
							<div class="room-config-row">
								<div class="room-config-label">Mode</div>
								<div class="room-mode-toggle">
									<button id="btn-mode-race" class="room-mode-btn ${ this.selectedMode !== 'sandbox' ? 'active' : '' }" ${ isHost ? '' : 'disabled' }>Course</button>
									<button id="btn-mode-sandbox" class="room-mode-btn ${ this.selectedMode === 'sandbox' ? 'active' : '' }" ${ isHost ? '' : 'disabled' }>Sandbox</button>
								</div>
							</div>
							<div id="room-lap-row" class="room-config-row" style="${ this.selectedMode === 'sandbox' ? 'display:none' : '' }">
								<div class="room-config-label">Tours</div>
								<div class="room-lap-row">
									<span class="room-lap-label">Nombre de tours</span>
									<div class="room-lap-controls">
										<button id="btn-laps-minus" class="room-lap-btn" ${ isHost ? '' : 'disabled' }>−</button>
										<span id="lap-count" class="room-lap-value">${ this.selectedLaps }</span>
										<button id="btn-laps-plus" class="room-lap-btn" ${ isHost ? '' : 'disabled' }>+</button>
									</div>
								</div>
							</div>
							<div class="room-config-row">
								<div class="room-config-label">Météo</div>
								<div class="room-weather-toggle">
									${ [ 'random', 'clear', 'rain', 'fog', 'storm', 'night' ].map( ( w ) => {
										const labels = { random: '🎲', clear: '☀️', rain: '🌧️', fog: '🌫️', storm: '⛈️', night: '🌙' };
										const active  = this.selectedWeather === w ? ' active' : '';
										const dis     = isHost ? '' : ' disabled';
										return `<button id="btn-weather-${ w }" class="room-weather-btn${ active }"${ dis } title="${ w }">${ labels[ w ] }</button>`;
									} ).join( '' ) }
								</div>
							</div>
							${ isHost ? `<button id="btn-start" class="room-start-btn">Démarrer la partie</button>` : `
							<div class="room-waiting">
								<div class="room-waiting-dots"><span></span><span></span><span></span></div>
								<span>En attente du host...</span>
							</div>` }
						</div>
					</div>
				</div>
			</div>`;

		document.getElementById( 'btn-leave-room' ).addEventListener( 'click', () => {

			if ( this.onLeaveRoom ) this.onLeaveRoom();

		} );

		if ( isHost ) {

			document.getElementById( 'btn-change-circuit' ).addEventListener( 'click', () => {

				this._showCircuitOverlay();

			} );

			document.getElementById( 'btn-mode-race' ).addEventListener( 'click', () => {

				this.selectedMode = 'race';
				document.getElementById( 'btn-mode-race' ).classList.add( 'active' );
				document.getElementById( 'btn-mode-sandbox' ).classList.remove( 'active' );
				document.getElementById( 'room-lap-row' ).style.display = '';

			} );

			document.getElementById( 'btn-mode-sandbox' ).addEventListener( 'click', () => {

				this.selectedMode = 'sandbox';
				document.getElementById( 'btn-mode-sandbox' ).classList.add( 'active' );
				document.getElementById( 'btn-mode-race' ).classList.remove( 'active' );
				document.getElementById( 'room-lap-row' ).style.display = 'none';

			} );

			document.getElementById( 'btn-laps-minus' ).addEventListener( 'click', () => {

				this.selectedLaps = Math.max( 1, this.selectedLaps - 1 );
				document.getElementById( 'lap-count' ).textContent = this.selectedLaps;

			} );

			document.getElementById( 'btn-laps-plus' ).addEventListener( 'click', () => {

				this.selectedLaps = Math.min( 10, this.selectedLaps + 1 );
				document.getElementById( 'lap-count' ).textContent = this.selectedLaps;

			} );

			for ( const w of [ 'random', 'clear', 'rain', 'fog', 'storm', 'night' ] ) {

				document.getElementById( `btn-weather-${ w }` ).addEventListener( 'click', () => {

					this.selectedWeather = w;
					for ( const ww of [ 'random', 'clear', 'rain', 'fog', 'storm', 'night' ] ) {

						document.getElementById( `btn-weather-${ ww }` ).classList.toggle( 'active', ww === w );

					}

				} );

			}

			document.getElementById( 'btn-start' ).addEventListener( 'click', () => {

				if ( this.onStartRace ) this.onStartRace( { mode: this.selectedMode, laps: this.selectedLaps, weather: this.selectedWeather } );

			} );

		}

	}

	// ─── Circuit overlay (host, inside room lobby) ────────────────────────────

	_showCircuitOverlay() {

		const circuits = loadCircuits();

		const cards = circuits.map( ( circuit ) => {

			const minimap = generateMinimap( circuit.cells, 64 );
			const active = circuit.name === this._selectedCircuitName ? ' active' : '';

			return `
				<div class="circuit-card${ active }" data-id="${ circuit.id }">
					<div class="circuit-minimap">${ minimap }</div>
					<div class="circuit-name">${ escHtml( circuit.name ) }</div>
				</div>`;

		} ).join( '' );

		const overlay = document.createElement( 'div' );
		overlay.className = 'circuit-overlay';
		overlay.innerHTML = `
			<div class="circuit-overlay-panel">
				<div class="lobby-header-row" style="margin-bottom:16px">
					<button id="btn-overlay-back" class="back-btn">← Retour</button>
					<h1 style="font-size:24px;margin:0">Changer de circuit</h1>
				</div>
				<div class="circuit-grid">${ cards }</div>
			</div>`;

		this.container.appendChild( overlay );

		overlay.querySelectorAll( '.circuit-card' ).forEach( ( card ) => {

			card.addEventListener( 'click', () => {

				const id = card.dataset.id;
				const circuit = circuits.find( ( c ) => c.id === id );
				if ( ! circuit ) return;

				this._selectCircuit( circuit, null );
				overlay.remove();
				this.updateCircuit( circuit.cells, circuit.name );

				if ( this.onCircuitChange ) this.onCircuitChange( circuit.cells );

			} );

		} );

		document.getElementById( 'btn-overlay-back' ).addEventListener( 'click', () => {

			overlay.remove();

		} );

	}

	// Called by main.js when the server broadcasts a map change (for clients)
	updateCircuit( cells, circuitName ) {

		this.selectedCells = cells;
		this._selectedCircuitName = circuitName || 'Circuit';

		// Re-render the circuit preview area if we're in the room lobby
		const previewEl = document.getElementById( 'btn-change-circuit' );
		if ( ! previewEl ) return;

		const minimapEl = previewEl.querySelector( '.room-circuit-minimap' );
		const nameEl = previewEl.querySelector( '.room-circuit-name' );
		if ( minimapEl ) minimapEl.innerHTML = cells ? generateMinimap( cells, 52 ) : '';
		if ( nameEl ) nameEl.textContent = circuitName || 'Circuit';

	}

	updatePlayers( players ) {

		const el = document.getElementById( 'lobby-players' );
		if ( ! el ) { this._pendingPlayers = players; return; }

		const MAX_SLOTS = 4;
		const COLOR_HEX = { yellow: '#f5c842', green: '#4fcf6a', purple: '#a855f7', red: '#ef4444' };

		let rows = players.map( ( p ) => {

			const isMe = p.username === this.selectedUsername;
			const dot = COLOR_HEX[ p.color ] || '#fff';
			const tags = [];
			if ( p.isHost ) tags.push( `<span class="room-player-tag host-tag">Host</span>` );
			if ( isMe )     tags.push( `<span class="room-player-tag me-tag">Moi</span>` );

			return `
				<div class="room-player-row ${ isMe ? 'me' : '' }">
					<div class="room-player-dot" style="background:${ dot }"></div>
					<div class="room-player-name">${ escHtml( p.username || p.color ) }</div>
					${ tags.join( '' ) }
				</div>`;

		} );

		// Fill empty slots
		for ( let i = players.length; i < MAX_SLOTS; i++ ) {

			rows.push( `
				<div class="room-player-row empty">
					<div class="room-player-dot" style="background:rgba(255,255,255,0.2)"></div>
					<div class="room-player-name">Slot libre</div>
				</div>` );

		}

		const countEl = document.getElementById( 'room-player-count' );
		if ( countEl ) countEl.textContent = `${ players.length }/${ MAX_SLOTS }`;

		el.innerHTML = rows.join( '' );

	}

	showError( msg ) {

		this._removeConnectingOverlay();

		const statusEl = document.getElementById( 'circuit-status' ) || document.getElementById( 'join-code-status' );

		if ( statusEl ) {

			statusEl.textContent = msg;
			[ 'btn-confirm', 'btn-create', 'btn-offline', 'btn-join-code' ].forEach( ( id ) => {

				const el = document.getElementById( id );
				if ( el ) el.disabled = false;

			} );

		} else {

			// Mode screen was replaced — rebuild it with the error
			this.container.classList.remove( 'ms-fullscreen' );
			this._buildModeScreen();
			requestAnimationFrame( () => {

				const s = document.getElementById( 'join-code-status' );
				if ( s ) s.textContent = msg;

			} );

		}

	}

	hide() {

		this.container.style.display = 'none';

	}

	show() {

		this.container.style.display = '';

	}

}
