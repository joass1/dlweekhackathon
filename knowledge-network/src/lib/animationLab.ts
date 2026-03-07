export type AssetFormat = 'gltf' | 'fbx';

export type CharacterAsset = {
  id: string;
  label: string;
  url: string;
  format: AssetFormat;
  bossEligible: boolean;
};

export type BossAnimationPreset = {
  characterId: string;
  modelUrl: string;
  weaponId: string;
  weaponUrl: string | null;
  headVariant: 'original' | 'horse';
  idleClip: string;
  hitClip: string;
  deathClip: string;
  attackClips: string[];
  attackIntervalSec: number;
};

export const ANIMATION_LAB_STORAGE_KEY = 'mentora:animation-lab:last';
export const BOSS_PRESET_STORAGE_KEY = 'mentora:boss-animation-preset:v1';

export const CHARACTER_ASSETS: CharacterAsset[] = [
  { id: 'spacesuit', label: 'Spacesuit', url: '/models/spacesuit.gltf', format: 'gltf', bossEligible: true },
  { id: 'adventurer', label: 'Adventurer', url: '/models/adventurer.gltf', format: 'gltf', bossEligible: true },
  { id: 'casual_2', label: 'Casual 2', url: '/models/casual_2.gltf', format: 'gltf', bossEligible: true },
  { id: 'king', label: 'King', url: '/models/king.gltf', format: 'gltf', bossEligible: true },
  { id: 'beach', label: 'Beach', url: '/models/umm/beach.gltf', format: 'gltf', bossEligible: true },
  { id: 'casual_hoodie', label: 'Casual Hoodie', url: '/models/umm/casual_hoodie.gltf', format: 'gltf', bossEligible: true },
  { id: 'farmer', label: 'Farmer', url: '/models/umm/farmer.gltf', format: 'gltf', bossEligible: true },
  { id: 'punk', label: 'Punk', url: '/models/umm/punk.gltf', format: 'gltf', bossEligible: true },
  { id: 'suit', label: 'Suit', url: '/models/umm/suit.gltf', format: 'gltf', bossEligible: true },
  { id: 'swat', label: 'Swat', url: '/models/umm/swat.gltf', format: 'gltf', bossEligible: true },
  { id: 'worker', label: 'Worker', url: '/models/umm/worker.gltf', format: 'gltf', bossEligible: true },
];

export type WeaponAsset = {
  id: string;
  label: string;
  url: string | null;
  format: AssetFormat | 'none';
};

export const WEAPON_ASSETS: WeaponAsset[] = [
  { id: 'none', label: 'None', url: null, format: 'none' },
  { id: 'sword_scifi', label: 'Sci-Fi Sword', url: '/models/scifi/Sword_Bronze.gltf', format: 'gltf' },
  { id: 'sword_fantasy', label: 'Fantasy Sword', url: '/models/fantasy/Sword_Bronze.gltf', format: 'gltf' },
  { id: 'axe_fantasy', label: 'Fantasy Axe', url: '/models/fantasy/Axe_Bronze.gltf', format: 'gltf' },
  { id: 'pistol_umm', label: 'UMM Pistol', url: '/models/umm-weapons/pistol.fbx', format: 'fbx' },
];

export const ALL_ANIMATION_CLIPS = [
  'Death',
  'Gun_Shoot',
  'HitRecieve',
  'HitRecieve_2',
  'Idle',
  'Idle_Gun',
  'Idle_Gun_Pointing',
  'Idle_Gun_Shoot',
  'Idle_Neutral',
  'Idle_Sword',
  'Interact',
  'Kick_Left',
  'Kick_Right',
  'Punch_Left',
  'Punch_Right',
  'Roll',
  'Run',
  'Run_Back',
  'Run_Left',
  'Run_Right',
  'Run_Shoot',
  'Sword_Slash',
  'Walk',
  'Wave',
];

export const DEFAULT_BOSS_PRESET: BossAnimationPreset = {
  characterId: 'spacesuit',
  modelUrl: '/models/spacesuit.gltf',
  weaponId: 'sword_scifi',
  weaponUrl: '/models/scifi/Sword_Bronze.gltf',
  headVariant: 'original',
  idleClip: 'Idle_Neutral',
  hitClip: 'HitRecieve',
  deathClip: 'Death',
  attackClips: ['Sword_Slash', 'Punch_Left', 'Punch_Right', 'Kick_Left', 'Kick_Right', 'Gun_Shoot', 'Run_Shoot'],
  attackIntervalSec: 5,
};

export function getCharacterById(id: string): CharacterAsset | undefined {
  return CHARACTER_ASSETS.find((asset) => asset.id === id);
}

export function safeParseBossPreset(raw: string | null): BossAnimationPreset | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BossAnimationPreset>;
    if (!parsed || typeof parsed !== 'object') return null;
    const characterId = typeof parsed.characterId === 'string' ? parsed.characterId : DEFAULT_BOSS_PRESET.characterId;
    const validCharacter = CHARACTER_ASSETS.find((asset) => asset.id === characterId && asset.bossEligible && asset.format === 'gltf');
    const modelUrlFromParsed = typeof parsed.modelUrl === 'string' ? parsed.modelUrl : undefined;
    const allowedModelUrls = new Set(
      CHARACTER_ASSETS.filter((asset) => asset.bossEligible && asset.format === 'gltf').map((asset) => asset.url)
    );
    const modelUrl = validCharacter?.url
      ?? (modelUrlFromParsed && allowedModelUrls.has(modelUrlFromParsed) ? modelUrlFromParsed : DEFAULT_BOSS_PRESET.modelUrl);
    const idleClip = typeof parsed.idleClip === 'string' ? parsed.idleClip : DEFAULT_BOSS_PRESET.idleClip;
    const hitClip = typeof parsed.hitClip === 'string' ? parsed.hitClip : DEFAULT_BOSS_PRESET.hitClip;
    const deathClip = typeof parsed.deathClip === 'string' ? parsed.deathClip : DEFAULT_BOSS_PRESET.deathClip;
    const weaponId = typeof parsed.weaponId === 'string' ? parsed.weaponId : DEFAULT_BOSS_PRESET.weaponId;
    const weapon = WEAPON_ASSETS.find((item) => item.id === weaponId) ?? WEAPON_ASSETS[0];
    const headVariant = parsed.headVariant === 'horse' ? 'horse' : 'original';
    const attackClips = Array.isArray(parsed.attackClips)
      ? parsed.attackClips.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      : DEFAULT_BOSS_PRESET.attackClips;
    const attackIntervalSec =
      typeof parsed.attackIntervalSec === 'number' && Number.isFinite(parsed.attackIntervalSec)
        ? Math.max(1.5, Math.min(12, parsed.attackIntervalSec))
        : DEFAULT_BOSS_PRESET.attackIntervalSec;

    return {
      characterId,
      modelUrl,
      weaponId: weapon.id,
      weaponUrl: weapon.url,
      headVariant,
      idleClip,
      hitClip,
      deathClip,
      attackClips: attackClips.length > 0 ? attackClips : DEFAULT_BOSS_PRESET.attackClips,
      attackIntervalSec,
    };
  } catch {
    return null;
  }
}
