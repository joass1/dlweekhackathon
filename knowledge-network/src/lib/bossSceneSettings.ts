import { ALL_ANIMATION_CLIPS } from '@/lib/animationLab';

export const BOSS_SCENE_SETTINGS_STORAGE_KEY = 'mentora:boss-scene-settings:v1';

export const BOSS_IDS = ['spacesuit', 'swat', 'punk', 'suit'] as const;
export type BossId = (typeof BOSS_IDS)[number];

export const BOSS_LABELS: Record<BossId, string> = {
  spacesuit: 'Spacesuit',
  swat: 'SWAT',
  punk: 'Punk',
  suit: 'Suit',
};

export const MELEE_ATTACK_OPTIONS = ['Punch_Left', 'Punch_Right', 'Kick_Left', 'Kick_Right'] as const;
export const GUN_ATTACK_OPTIONS = ['Gun_Shoot', 'Idle_Gun_Shoot', 'Run_Shoot'] as const;

export const BOSS_ATTACK_OPTIONS: Record<BossId, readonly string[]> = {
  spacesuit: MELEE_ATTACK_OPTIONS,
  swat: GUN_ATTACK_OPTIONS,
  punk: MELEE_ATTACK_OPTIONS,
  suit: GUN_ATTACK_OPTIONS,
};

export const BACKGROUND_VARIANT_OPTIONS = ['default', 'minimal', 'fortified'] as const;
export type BackgroundVariant = (typeof BACKGROUND_VARIANT_OPTIONS)[number];

export type BossSceneSetting = {
  idleClip: string;
  hitClip: string;
  deathClip: string;
  attackClips: string[];
  attackIntervalSec: number;
  backgroundVariant: BackgroundVariant;
  fogColor: string;
  particleCount: number;
};

export type BossSceneSettings = Record<BossId, BossSceneSetting>;

export const DEFAULT_BOSS_SCENE_SETTINGS: BossSceneSettings = {
  spacesuit: {
    idleClip: 'Idle_Neutral',
    hitClip: 'HitRecieve',
    deathClip: 'Death',
    attackClips: [...MELEE_ATTACK_OPTIONS],
    attackIntervalSec: 5,
    backgroundVariant: 'default',
    fogColor: '#081b33',
    particleCount: 38,
  },
  swat: {
    idleClip: 'Idle_Gun',
    hitClip: 'HitRecieve',
    deathClip: 'Death',
    attackClips: [...GUN_ATTACK_OPTIONS],
    attackIntervalSec: 4.5,
    backgroundVariant: 'default',
    fogColor: '#101a2f',
    particleCount: 46,
  },
  punk: {
    idleClip: 'Idle_Neutral',
    hitClip: 'HitRecieve',
    deathClip: 'Death',
    attackClips: [...MELEE_ATTACK_OPTIONS],
    attackIntervalSec: 4.8,
    backgroundVariant: 'default',
    fogColor: '#1e1626',
    particleCount: 34,
  },
  suit: {
    idleClip: 'Idle_Gun',
    hitClip: 'HitRecieve',
    deathClip: 'Death',
    attackClips: [...GUN_ATTACK_OPTIONS],
    attackIntervalSec: 4.5,
    backgroundVariant: 'default',
    fogColor: '#0f2136',
    particleCount: 42,
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isHexColor(value: string) {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
}

export function cloneBossSceneSettings(source: BossSceneSettings): BossSceneSettings {
  return {
    spacesuit: { ...source.spacesuit, attackClips: [...source.spacesuit.attackClips] },
    swat: { ...source.swat, attackClips: [...source.swat.attackClips] },
    punk: { ...source.punk, attackClips: [...source.punk.attackClips] },
    suit: { ...source.suit, attackClips: [...source.suit.attackClips] },
  };
}

function sanitizeSingleBossSetting(bossId: BossId, raw: unknown): BossSceneSetting {
  const fallback = DEFAULT_BOSS_SCENE_SETTINGS[bossId];
  if (!raw || typeof raw !== 'object') return { ...fallback, attackClips: [...fallback.attackClips] };

  const value = raw as Partial<BossSceneSetting>;
  const allowedClips = new Set(BOSS_ATTACK_OPTIONS[bossId]);
  const validAllClips = new Set(ALL_ANIMATION_CLIPS);

  const idleClip =
    typeof value.idleClip === 'string' && validAllClips.has(value.idleClip) ? value.idleClip : fallback.idleClip;
  const hitClip = typeof value.hitClip === 'string' && validAllClips.has(value.hitClip) ? value.hitClip : fallback.hitClip;
  const deathClip =
    typeof value.deathClip === 'string' && validAllClips.has(value.deathClip) ? value.deathClip : fallback.deathClip;

  const attackClipsRaw = Array.isArray(value.attackClips) ? value.attackClips : fallback.attackClips;
  const attackClips = attackClipsRaw.filter(
    (clip): clip is string => typeof clip === 'string' && allowedClips.has(clip)
  );

  const attackIntervalSec =
    typeof value.attackIntervalSec === 'number' && Number.isFinite(value.attackIntervalSec)
      ? clamp(value.attackIntervalSec, 1.5, 12)
      : fallback.attackIntervalSec;

  const backgroundVariant =
    typeof value.backgroundVariant === 'string' && BACKGROUND_VARIANT_OPTIONS.includes(value.backgroundVariant as BackgroundVariant)
      ? (value.backgroundVariant as BackgroundVariant)
      : fallback.backgroundVariant;

  const fogColor =
    typeof value.fogColor === 'string' && isHexColor(value.fogColor) ? value.fogColor : fallback.fogColor;

  const particleCount =
    typeof value.particleCount === 'number' && Number.isFinite(value.particleCount)
      ? Math.round(clamp(value.particleCount, 0, 120))
      : fallback.particleCount;

  return {
    idleClip,
    hitClip,
    deathClip,
    attackClips: attackClips.length > 0 ? attackClips : [...fallback.attackClips],
    attackIntervalSec,
    backgroundVariant,
    fogColor,
    particleCount,
  };
}

export function parseBossSceneSettings(raw: string | null): BossSceneSettings {
  if (!raw) return cloneBossSceneSettings(DEFAULT_BOSS_SCENE_SETTINGS);
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      spacesuit: sanitizeSingleBossSetting('spacesuit', parsed?.spacesuit),
      swat: sanitizeSingleBossSetting('swat', parsed?.swat),
      punk: sanitizeSingleBossSetting('punk', parsed?.punk),
      suit: sanitizeSingleBossSetting('suit', parsed?.suit),
    };
  } catch {
    return cloneBossSceneSettings(DEFAULT_BOSS_SCENE_SETTINGS);
  }
}
