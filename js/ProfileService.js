/**
 * ProfileService
 * Handles register/login against the server API and caches the profile locally.
 */

const LS_PROFILE = 'myrace_profile';

class ProfileService {

    constructor() {

        this._profile = null;
        this._load();

    }

    // ── Persistence ───────────────────────────────────────────────────────────

    _load() {

        try {

            const raw = localStorage.getItem( LS_PROFILE );
            if ( raw ) this._profile = JSON.parse( raw );

        } catch { /* ignore */ }

    }

    _save() {

        if ( this._profile ) {

            localStorage.setItem( LS_PROFILE, JSON.stringify( this._profile ) );

        }

    }

    // ── Public API ────────────────────────────────────────────────────────────

    get profile()  { return this._profile; }
    get username() { return this._profile?.username || null; }
    get level()    { return this._profile?.level    ?? 1; }
    get xp()       { return this._profile?.xp       ?? 0; }
    get xpThisLevel() { return this._profile?.xp_this_level ?? 0; }
    get xpForNext()   { return this._profile?.xp_for_next   ?? 141; }
    get credits()  { return this._profile?.credits  ?? 0; }

    isLoggedIn() { return !! this._profile; }

    /**
     * Register a new player. Returns { ok, error }.
     */
    async register( username ) {

        try {

            const res = await fetch( '/api/auth/register', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify( { username } ),
            } );

            const data = await res.json();

            if ( ! res.ok ) return { ok: false, error: data.error || 'Erreur serveur' };

            // Fetch full profile (includes stats)
            return this.login( username );

        } catch {

            return { ok: false, error: 'Serveur inaccessible' };

        }

    }

    /**
     * Login an existing player. Returns { ok, error }.
     */
    async login( username ) {

        try {

            const res = await fetch( '/api/auth/login', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify( { username } ),
            } );

            const data = await res.json();

            if ( ! res.ok ) return { ok: false, error: data.error || 'Joueur introuvable' };

            this._profile = data.player;
            this._save();
            return { ok: true };

        } catch {

            return { ok: false, error: 'Serveur inaccessible' };

        }

    }

    /**
     * Refresh profile from server (call after a race to get updated XP/credits).
     */
    async refresh() {

        if ( ! this.username ) return;

        try {

            const res  = await fetch( `/api/profile/${ encodeURIComponent( this.username ) }` );
            const data = await res.json();
            if ( res.ok ) { this._profile = data.player; this._save(); }

        } catch { /* non-fatal */ }

    }

    /**
     * Merge updated fields returned by /api/profile/race-result directly
     * so we don't need a round-trip to refresh.
     */
    applyRaceResult( result ) {

        if ( ! this._profile ) return;
        Object.assign( this._profile, {
            xp:           result.xp,
            xp_this_level: result.xp_this_level,
            xp_for_next:  result.xp_for_next,
            credits:      result.credits,
            level:        result.new_level,
        } );
        this._save();

    }

    logout() {

        this._profile = null;
        localStorage.removeItem( LS_PROFILE );

    }

}

// Singleton
export const profileService = new ProfileService();
