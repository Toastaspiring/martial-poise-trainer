export const KALISTA_CONSTANTS = {
    BASE_AS: 0.694,
    BASE_WINDUP_PERCENT: 0.36,
    ATTACK_RANGE_PIXELS: 250,
    WINDUP_MODIFIER: 0.75,
    BASE_AD: 100,
    DAMAGE_MODIFIER: 0.9,
    BASE_MS: 325,
    BOOTS_MS: [0, 25, 45],
    PLAYER_MAX_HP: 600,
    PLAYER_ARMOR: 24,
};

export const SCALE_RATIO = KALISTA_CONSTANTS.ATTACK_RANGE_PIXELS / 525;

export const DASH_RANGES_BACK = [250 * SCALE_RATIO, 265 * SCALE_RATIO, 280 * SCALE_RATIO];
export const DASH_RANGES_FWD = [150 * SCALE_RATIO, 165 * SCALE_RATIO, 180 * SCALE_RATIO];

export class KalistaModel {
    static calculateWindup(currentAS) {
        const bonusASPercent = Math.max(0, (currentAS / KALISTA_CONSTANTS.BASE_AS) - 1);
        const baseAttackPeriod = 1.0 / KALISTA_CONSTANTS.BASE_AS;
        const baseWindupTime = baseAttackPeriod * KALISTA_CONSTANTS.BASE_WINDUP_PERCENT;
        return baseWindupTime / (1 + (bonusASPercent * KALISTA_CONSTANTS.WINDUP_MODIFIER));
    }

    static calculateMoveSpeed(bootsTier) {
        return (KALISTA_CONSTANTS.BASE_MS + KALISTA_CONSTANTS.BOOTS_MS[bootsTier]) * SCALE_RATIO;
    }

    static getDashRanges(bootsTier) {
        return {
            back: Math.round(DASH_RANGES_BACK[bootsTier] / SCALE_RATIO),
            fwd: Math.round(DASH_RANGES_FWD[bootsTier] / SCALE_RATIO)
        };
    }

    static calculateDamage() {
        return KALISTA_CONSTANTS.BASE_AD * KALISTA_CONSTANTS.DAMAGE_MODIFIER;
    }

    static calculateDamageTaken(rawDamage) {
        const multiplier = 100 / (100 + KALISTA_CONSTANTS.PLAYER_ARMOR);
        return rawDamage * multiplier;
    }
}
