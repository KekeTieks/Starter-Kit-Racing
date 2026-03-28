/**
 * XP & credit system
 *
 * Level curve: xp needed to go from level n-1 → n = floor(100 * n^1.5)
 *   Level 1→2 :   141 XP
 *   Level 5→6 :   549 XP
 *   Level 10→11: 1097 XP
 *   Level 20→21: 2191 XP
 *
 * Race rewards (base, 4-player room):
 *   Rank 1 → 100 XP / 80 credits
 *   Rank 2 →  70 XP / 55 credits
 *   Rank 3 →  45 XP / 35 credits
 *   Rank 4 →  25 XP / 20 credits
 *   DNF    →  10 XP /  5 credits
 *
 * Scaled by (players_count / MAX_PLAYERS) so a 1v1 gives 50% of full rewards.
 */

const MAX_PLAYERS = 4;

const RANK_REWARDS = [
    { xp: 100, credits: 80 },  // rank 1
    { xp:  70, credits: 55 },  // rank 2
    { xp:  45, credits: 35 },  // rank 3
    { xp:  25, credits: 20 },  // rank 4
];
const DNF_REWARD = { xp: 10, credits: 5 };

/** XP required to advance from level (n-1) to level n */
export function xpForLevel( n ) {

    return Math.floor( 100 * Math.pow( n, 1.5 ) );

}

/** Total cumulative XP needed to reach level n from level 1 */
export function totalXpForLevel( n ) {

    let total = 0;
    for ( let i = 2; i <= n; i++ ) total += xpForLevel( i );
    return total;

}

/**
 * Compute the new level and within-level progress after adding xp.
 * Returns { level, xp_this_level, xp_for_next }
 */
export function computeLevel( currentLevel, currentXpThisLevel, xpGained ) {

    let level       = currentLevel;
    let xpThisLevel = currentXpThisLevel + xpGained;

    // Level-up loop
    while ( true ) {

        const needed = xpForLevel( level + 1 );
        if ( xpThisLevel < needed ) break;
        xpThisLevel -= needed;
        level++;

    }

    return {
        level,
        xp_this_level: xpThisLevel,
        xp_for_next:   xpForLevel( level + 1 ),
    };

}

/**
 * Compute rewards for a race finish.
 * @param {number} rank          1-based finish position (0 = DNF)
 * @param {number} playersCount  number of players in the race
 */
export function computeRaceRewards( rank, playersCount ) {

    const base   = ( rank >= 1 && rank <= RANK_REWARDS.length )
        ? RANK_REWARDS[ rank - 1 ]
        : DNF_REWARD;

    const scale  = Math.min( playersCount, MAX_PLAYERS ) / MAX_PLAYERS;

    return {
        xp:      Math.round( base.xp      * scale ),
        credits: Math.round( base.credits * scale ),
    };

}
