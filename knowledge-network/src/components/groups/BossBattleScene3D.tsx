'use client';

import React, { Suspense, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useAnimations, useFBX, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  BOSS_PRESET_STORAGE_KEY,
  DEFAULT_BOSS_PRESET,
  WEAPON_ASSETS,
  safeParseBossPreset,
  type BossAnimationPreset,
} from '@/lib/animationLab';
import {
  BOSS_ATTACK_OPTIONS,
  BOSS_SCENE_SETTINGS_STORAGE_KEY,
  DEFAULT_BOSS_SCENE_SETTINGS,
  cloneBossSceneSettings,
  parseBossSceneSettings,
  type BackgroundVariant,
  type BossId,
  type BossSceneSettings,
} from '@/lib/bossSceneSettings';

type VisibilitySnapshot = { node: THREE.Object3D; visible: boolean };
type ArenaPiece = {
  url: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
};

const BOSS_LOBBY_CHARACTER_KEY_PREFIX = 'mentora:boss:lobby-character:v1:';

const BOSS_RANDOM_POOL = [
  {
    id: 'spacesuit',
    modelUrl: '/models/spacesuit.gltf',
    weaponId: 'none',
    weaponUrl: null,
  },
  {
    id: 'swat',
    modelUrl: '/models/umm/swat.gltf',
    weaponId: 'pistol_umm',
    weaponUrl: '/models/umm-weapons/pistol.fbx',
  },
  {
    id: 'punk',
    modelUrl: '/models/umm/punk.gltf',
    weaponId: 'none',
    weaponUrl: null,
  },
  {
    id: 'suit',
    modelUrl: '/models/umm/suit.gltf',
    weaponId: 'pistol_umm',
    weaponUrl: '/models/umm-weapons/pistol.fbx',
  },
] as const;

const BOSS_ARENA_FORTIFIED_EXTRAS: Record<BossId, ArenaPiece[]> = {
  spacesuit: [
    { url: '/models/scifi/Prop_Crate3.gltf', position: [-3.45, -2.3, -0.85], rotation: [0, 0.35, 0], scale: 0.82 },
    { url: '/models/scifi/Prop_Crate3.gltf', position: [3.45, -2.3, -0.85], rotation: [0, -0.35, 0], scale: 0.82 },
  ],
  swat: [
    { url: '/models/scifi/Prop_Crate3.gltf', position: [-3.45, -2.3, -4.15], rotation: [0, 0.45, 0], scale: 0.8 },
    { url: '/models/scifi/Prop_Crate3.gltf', position: [3.45, -2.3, -4.15], rotation: [0, -0.45, 0], scale: 0.8 },
    { url: '/models/scifi/Prop_Vent_Wide.gltf', position: [-3.5, -2.3, -2.75], rotation: [0, 0.25, 0], scale: 0.82 },
    { url: '/models/scifi/Prop_Vent_Wide.gltf', position: [3.5, -2.3, -2.75], rotation: [0, -0.25, 0], scale: 0.82 },
  ],
  punk: [
    { url: '/models/fantasy-props/Lantern_Wall.gltf', position: [-3.55, -2.3, -0.8], rotation: [0, 0.2, 0], scale: 0.9 },
    { url: '/models/fantasy-props/Shield_Wooden.gltf', position: [3.55, -2.3, -0.8], rotation: [0, -0.4, 0], scale: 0.85 },
    { url: '/models/fantasy-props/Barrel.gltf', position: [3.4, -2.3, -3.45], rotation: [0, -0.7, 0], scale: 0.95 },
    { url: '/models/fantasy-props/Torch_Metal.gltf', position: [-3.45, -2.3, -3.55], rotation: [0, 0.9, 0], scale: 0.9 },
  ],
  suit: [
    { url: '/models/scifi/Prop_Barrel_Large.gltf', position: [-3.55, -2.3, -3.1], rotation: [0, 0.45, 0], scale: 0.84 },
    { url: '/models/scifi/Prop_Barrel_Large.gltf', position: [3.55, -2.3, -3.1], rotation: [0, -0.45, 0], scale: 0.84 },
    { url: '/models/scifi/Prop_Fan_Small.gltf', position: [-3.35, -2.3, -4.75], rotation: [0, 0.2, 0], scale: 0.82 },
    { url: '/models/scifi/Prop_Fan_Small.gltf', position: [3.35, -2.3, -4.75], rotation: [0, -0.2, 0], scale: 0.82 },
  ],
};

const BOSS_ARENA_LAYOUTS: Record<
  (typeof BOSS_RANDOM_POOL)[number]['id'],
  {
    fogColor: string;
    particleCount: number;
    pieces: ArenaPiece[];
  }
> = {
  spacesuit: {
    fogColor: '#081b33',
    particleCount: 38,
    pieces: [
      { url: '/models/scifi/Column_Astra.gltf', position: [-3.2, -2.3, -2.9], rotation: [0, 0.25, 0], scale: 1.15 },
      { url: '/models/scifi/Column_Astra.gltf', position: [3.2, -2.3, -2.9], rotation: [0, -0.25, 0], scale: 1.15 },
      { url: '/models/scifi/Door_Frame_A.gltf', position: [0, -2.3, -4.2], scale: 1.35 },
      { url: '/models/scifi/Prop_AccessPoint.gltf', position: [-2.4, -2.3, -1.2], rotation: [0, 0.6, 0], scale: 0.9 },
      { url: '/models/scifi/Prop_AccessPoint.gltf', position: [2.45, -2.3, -1.4], rotation: [0, -0.6, 0], scale: 0.9 },
      { url: '/models/scifi/Prop_Computer.gltf', position: [2.7, -2.3, -3.2], rotation: [0, -0.9, 0], scale: 0.82 },
    ],
  },
  swat: {
    fogColor: '#101a2f',
    particleCount: 46,
    pieces: [
      { url: '/models/scifi/Column_Astra.gltf', position: [-3.25, -2.3, -3.45], rotation: [0, 0.22, 0], scale: 1.16 },
      { url: '/models/scifi/Column_Astra.gltf', position: [3.25, -2.3, -3.45], rotation: [0, -0.22, 0], scale: 1.16 },
      { url: '/models/scifi/Prop_Computer.gltf', position: [-2.95, -2.3, -2.65], rotation: [0, 0.95, 0], scale: 0.92 },
      { url: '/models/scifi/Prop_Computer.gltf', position: [2.95, -2.3, -2.65], rotation: [0, -0.95, 0], scale: 0.92 },
      { url: '/models/scifi/Prop_Light_Floor.gltf', position: [-3.3, -2.3, -2.25], rotation: [0, 0.2, 0], scale: 0.86 },
      { url: '/models/scifi/Prop_Light_Floor.gltf', position: [3.3, -2.3, -2.25], rotation: [0, -0.2, 0], scale: 0.86 },
    ],
  },
  punk: {
    fogColor: '#1e1626',
    particleCount: 34,
    pieces: [
      { url: '/models/fantasy-props/Barrel.gltf', position: [-3.1, -2.3, -1.25], rotation: [0, 0.25, 0], scale: 1.05 },
      { url: '/models/fantasy-props/Crate_Wooden.gltf', position: [2.9, -2.3, -1.35], rotation: [0, -0.35, 0], scale: 1.0 },
      { url: '/models/fantasy-props/Anvil.gltf', position: [-2.8, -2.3, -3.2], rotation: [0, 0.9, 0], scale: 1.0 },
      { url: '/models/fantasy-props/WeaponStand.gltf', position: [3.35, -2.3, -3.4], rotation: [0, -1.15, 0], scale: 0.95 },
      { url: '/models/fantasy-props/Cabinet.gltf', position: [-3.15, -2.3, -3.95], rotation: [0, 0.6, 0], scale: 0.84 },
      { url: '/models/fantasy-props/Bench.gltf', position: [3.05, -2.3, -2.75], rotation: [0, -0.9, 0], scale: 1.0 },
      { url: '/models/fantasy-props/Torch_Metal.gltf', position: [-3.35, -2.3, -1.55], rotation: [0, 0.1, 0], scale: 0.95 },
      { url: '/models/fantasy-props/Shield_Wooden.gltf', position: [3.35, -2.3, -1.45], rotation: [0, -0.4, 0], scale: 0.8 },
      { url: '/models/fantasy-props/Chandelier.gltf', position: [0, -1.1, -4.4], scale: 0.68 },
      { url: '/models/fantasy-props/Lantern_Wall.gltf', position: [-3.35, -2.3, -2.45], rotation: [0, 1.2, 0], scale: 0.9 },
      { url: '/models/fantasy-props/Barrel.gltf', position: [3.15, -2.3, -0.35], rotation: [0, -0.25, 0], scale: 0.9 },
    ],
  },
  suit: {
    fogColor: '#0f2136',
    particleCount: 42,
    pieces: [
      { url: '/models/scifi/Door_Frame_A.gltf', position: [0, -2.3, -5.05], scale: 1.32 },
      { url: '/models/scifi/Prop_Vent_Wide.gltf', position: [-3.45, -2.3, -2.55], rotation: [0, 0.55, 0], scale: 0.92 },
      { url: '/models/scifi/Prop_Vent_Wide.gltf', position: [3.45, -2.3, -2.55], rotation: [0, -0.55, 0], scale: 0.92 },
      { url: '/models/scifi/Prop_Crate4.gltf', position: [-3.15, -2.3, -4.35], rotation: [0, 0.85, 0], scale: 0.86 },
      { url: '/models/scifi/Prop_Crate4.gltf', position: [3.15, -2.3, -4.35], rotation: [0, -0.85, 0], scale: 0.86 },
      { url: '/models/scifi/Prop_Computer.gltf', position: [-2.75, -2.3, -4.05], rotation: [0, 0.95, 0], scale: 0.85 },
      { url: '/models/scifi/Prop_Computer.gltf', position: [2.75, -2.3, -4.05], rotation: [0, -0.95, 0], scale: 0.85 },
      { url: '/models/scifi/Prop_Light_Corner.gltf', position: [-3.55, -2.3, -1.95], rotation: [0, 0.25, 0], scale: 0.9 },
      { url: '/models/scifi/Prop_Light_Corner.gltf', position: [3.55, -2.3, -1.95], rotation: [0, -0.25, 0], scale: 0.9 },
    ],
  },
};

function getRandomPoolMember(excludeId?: string) {
  const candidates = excludeId
    ? BOSS_RANDOM_POOL.filter((entry) => entry.id !== excludeId)
    : BOSS_RANDOM_POOL;
  if (candidates.length === 0) return BOSS_RANDOM_POOL[0];
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function isPoolCharacterId(value: string): value is (typeof BOSS_RANDOM_POOL)[number]['id'] {
  return BOSS_RANDOM_POOL.some((entry) => entry.id === value);
}

function getArenaPiecesForVariant(
  bossId: BossId,
  basePieces: ArenaPiece[],
  backgroundVariant: BackgroundVariant
) {
  if (backgroundVariant === 'minimal') {
    return basePieces.filter((_, idx) => idx % 2 === 0);
  }
  if (backgroundVariant === 'fortified') {
    return [...basePieces, ...BOSS_ARENA_FORTIFIED_EXTRAS[bossId]];
  }
  return basePieces;
}

function isMeleeWeapon(weaponId: string) {
  return weaponId === 'sword_scifi' || weaponId === 'sword_fantasy' || weaponId === 'axe_fantasy';
}

function getGripInset(weaponId: string) {
  if (weaponId === 'axe_fantasy') return 0.16;
  if (weaponId === 'sword_scifi' || weaponId === 'sword_fantasy') return 0.12;
  return 0;
}

function getWeaponTransform(weaponId: string) {
  if (weaponId === 'pistol_umm') {
    return { scale: 1.6, rotation: new THREE.Euler(0, Math.PI / 2, Math.PI / 2), position: new THREE.Vector3(0, 0, 0) };
  }
  if (weaponId === 'axe_fantasy') {
    return { scale: 1.35, rotation: new THREE.Euler(0, 0, Math.PI / 2), position: new THREE.Vector3(0, 0, 0) };
  }

  return {
    scale: 1.35,
    rotation: new THREE.Euler(0, 0, 0),
    position: new THREE.Vector3(0, 0, 0),
  };
}

function findHandTarget(root: THREE.Object3D, weaponId: string) {
  const preferred = isMeleeWeapon(weaponId)
    ? ['Middle1.R', 'Index1.R', 'Ring1.R', 'Pinky1.R', 'Thumb1.R', 'Wrist.R', 'Hand.R', 'RightHand', 'B-hand.R', 'hand_r', 'LowerArm.R']
    : ['Wrist.R', 'Hand.R', 'RightHand', 'B-hand.R', 'hand_r', 'LowerArm.R'];
  for (const name of preferred) {
    let found: THREE.Bone | null = null;
    root.traverse((obj) => {
      const skinned = obj as THREE.SkinnedMesh;
      if (found || !skinned.isSkinnedMesh || !skinned.skeleton) return;
      const hit = skinned.skeleton.bones.find((bone) => bone.name === name);
      if (hit) found = hit;
    });
    if (found) return found;
  }

  let bestBone: THREE.Bone | null = null;
  let bestScore = -1;
  root.traverse((obj) => {
    const skinned = obj as THREE.SkinnedMesh;
    if (!skinned.isSkinnedMesh || !skinned.skeleton) return;
    skinned.skeleton.bones.forEach((bone) => {
      const n = bone.name.toLowerCase();
      const right = /(^|[._ -])(r|right)([._ -]|$)/.test(n) || /right/.test(n);
      if (!right) return;
      let score = 0;
      if (isMeleeWeapon(weaponId) && /(index1|middle1|ring1|pinky1|thumb1)/.test(n)) score += 12;
      if (/hand/.test(n)) score += 8;
      if (/wrist|palm/.test(n)) score += 6;
      if (/forearm|lowerarm/.test(n)) score += 3;
      if (score > bestScore) {
        bestScore = score;
        bestBone = bone;
      }
    });
  });
  if (bestBone) return bestBone;

  const direct =
    (isMeleeWeapon(weaponId) ? root.getObjectByName('Middle1.R') : null) ??
    (isMeleeWeapon(weaponId) ? root.getObjectByName('Index1.R') : null) ??
    (isMeleeWeapon(weaponId) ? root.getObjectByName('Ring1.R') : null) ??
    root.getObjectByName('Wrist.R') ??
    root.getObjectByName('Hand.R') ??
    root.getObjectByName('RightHand') ??
    root.getObjectByName('B-hand.R') ??
    root.getObjectByName('hand_r') ??
    root.getObjectByName('LowerArm.R');
  if (direct) return direct;

  const matches: THREE.Object3D[] = [];
  root.traverse((obj) => {
    const name = (obj.name || '').toLowerCase();
    if (!name) return;
    const hasHandToken = isMeleeWeapon(weaponId)
      ? /(hand|wrist|palm|index1|middle1|ring1|pinky1|thumb1)/.test(name)
      : /(hand|wrist|palm)/.test(name);
    const isRightSide = /(^|[._ -])(r|right)([._ -]|$)/.test(name) || /right/.test(name);
    if (hasHandToken && isRightSide) matches.push(obj);
  });
  return matches[0] ?? null;
}

function findHeadTarget(root: THREE.Object3D) {
  const preferred = ['Head', 'head', 'B-head', 'mixamorigHead', 'Neck', 'neck'];
  for (const name of preferred) {
    let found: THREE.Bone | null = null;
    root.traverse((obj) => {
      const skinned = obj as THREE.SkinnedMesh;
      if (found || !skinned.isSkinnedMesh || !skinned.skeleton) return;
      const hit = skinned.skeleton.bones.find((bone) => bone.name === name);
      if (hit) found = hit;
    });
    if (found) return found;
  }

  let bestBone: THREE.Bone | null = null;
  let bestScore = -1;
  root.traverse((obj) => {
    const skinned = obj as THREE.SkinnedMesh;
    if (!skinned.isSkinnedMesh || !skinned.skeleton) return;
    skinned.skeleton.bones.forEach((bone) => {
      const n = bone.name.toLowerCase();
      let score = 0;
      if (/head/.test(n)) score += 8;
      if (/neck/.test(n)) score += 4;
      if (score > bestScore) {
        bestScore = score;
        bestBone = bone;
      }
    });
  });
  if (bestBone) return bestBone;

  return (
    root.getObjectByName('Head') ??
    root.getObjectByName('head') ??
    root.getObjectByName('Neck') ??
    root.getObjectByName('neck') ??
    root.getObjectByName('B-head') ??
    root.getObjectByName('HeadTop_End') ??
    root.getObjectByName('mixamorigHead')
  );
}

function isRenderableMesh(obj: THREE.Object3D): obj is THREE.Mesh | THREE.SkinnedMesh {
  const mesh = obj as THREE.Mesh;
  const skinned = obj as THREE.SkinnedMesh;
  return !!(mesh.isMesh || skinned.isSkinnedMesh);
}

function collectHeadMeshes(root: THREE.Object3D, headTarget: THREE.Object3D | null | undefined) {
  const meshes: THREE.Object3D[] = [];
  const headWorld = new THREE.Vector3();
  if (headTarget) headTarget.getWorldPosition(headWorld);

  const charBox = new THREE.Box3().setFromObject(root);
  const charSize = charBox.getSize(new THREE.Vector3());
  const charHeight = Math.max(charSize.y, 1);
  const shoulderY = charBox.min.y + charHeight * 0.52;

  root.traverse((obj) => {
    if (obj.name === '__lab_head_swap__' || obj.name === '__boss_head_swap__') return;
    if (!isRenderableMesh(obj)) return;

    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    if (size.y <= 0 || size.y > charHeight * 0.55) return;

    const name = (obj.name || '').toLowerCase();
    const byName = /(head|helmet|hair|hat|face|mask|beard)/.test(name);
    const center = box.getCenter(new THREE.Vector3());
    const nearHead = headTarget ? center.distanceTo(headWorld) <= charHeight * 0.38 : false;
    const inUpperBody = box.max.y >= shoulderY;

    if (byName || (nearHead && inUpperBody)) {
      meshes.push(obj);
    }
  });

  return meshes;
}

function getCombinedWorldBox(nodes: THREE.Object3D[]) {
  const box = new THREE.Box3();
  let hasBox = false;

  nodes.forEach((node) => {
    const nodeBox = new THREE.Box3().setFromObject(node);
    if (nodeBox.isEmpty()) return;
    if (!hasBox) {
      box.copy(nodeBox);
      hasBox = true;
      return;
    }
    box.union(nodeBox);
  });

  return hasBox ? box : null;
}

function getHeadPlacementBox(root: THREE.Object3D, headMeshes: THREE.Object3D[]) {
  const fromMeshes = getCombinedWorldBox(headMeshes);
  if (fromMeshes) return fromMeshes;

  const charBox = new THREE.Box3().setFromObject(root);
  if (charBox.isEmpty()) return null;

  const size = charBox.getSize(new THREE.Vector3());
  const center = charBox.getCenter(new THREE.Vector3());
  const halfX = Math.max(size.x * 0.12, 0.05);
  const halfZ = Math.max(size.z * 0.12, 0.05);
  const minY = charBox.max.y - size.y * 0.28;

  return new THREE.Box3(
    new THREE.Vector3(center.x - halfX, minY, center.z - halfZ),
    new THREE.Vector3(center.x + halfX, charBox.max.y, center.z + halfZ)
  );
}

function hideNodes(nodes: THREE.Object3D[]): VisibilitySnapshot[] {
  return nodes.map((node) => {
    const snapshot: VisibilitySnapshot = { node, visible: node.visible };
    node.visible = false;
    return snapshot;
  });
}

function restoreNodes(snapshots: VisibilitySnapshot[]) {
  snapshots.forEach(({ node, visible }) => {
    node.visible = visible;
  });
}

function removeNamedChild(root: THREE.Object3D, name: string) {
  const existing = root.getObjectByName(name);
  if (existing?.parent) existing.parent.remove(existing);
}

function mountHorseHead({
  source,
  parent,
  placementBox,
  nodeName,
}: {
  source: THREE.Object3D;
  parent: THREE.Object3D;
  placementBox: THREE.Box3;
  nodeName: string;
}) {
  const placementSize = placementBox.getSize(new THREE.Vector3());
  const targetHeight = Math.max(placementSize.y * 1.08, 0.18);
  const horse = buildHorseHeadClone(source, targetHeight);
  horse.name = nodeName;
  horse.rotation.set(0, 0, 0);

  const anchorWorld = placementBox.getCenter(new THREE.Vector3());
  anchorWorld.y = placementBox.min.y;
  horse.position.copy(parent.worldToLocal(anchorWorld));
  parent.add(horse);
  return horse;
}

function buildHorseHeadClone(source: THREE.Object3D, targetHeight = 0.42) {
  const horseRaw = skeletonClone(source) as THREE.Object3D;
  const holder = new THREE.Group();
  const box = new THREE.Box3().setFromObject(horseRaw);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const height = Math.max(size.y, 0.001);
  const minY = box.min.y;
  horseRaw.position.set(-center.x, -minY, -center.z);
  holder.add(horseRaw);
  holder.scale.setScalar(targetHeight / height);
  holder.traverse((obj) => {
    obj.frustumCulled = false;
  });
  return holder;
}

/* ── Sci-Fi Environment Piece ─────────────────────────────────────────── */

function SciFiModel({
  url,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: {
  url: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
}) {
  const gltf = useGLTF(url);
  const scene = useMemo(() => gltf.scene.clone(), [gltf.scene]);
  return (
    <primitive
      object={scene}
      position={position}
      rotation={rotation}
      scale={typeof scale === 'number' ? [scale, scale, scale] : scale}
    />
  );
}

/* ── Boss Model (unchanged logic) ─────────────────────────────────────── */

function BossModel({
  healthCurrent,
  healthMax,
  preset,
}: {
  healthCurrent: number;
  healthMax: number;
  preset: BossAnimationPreset;
}) {
  const gltf = useGLTF(preset.modelUrl);
  const horseHead = useFBX('/models/horse_head.fbx');
  const weaponSciFiSword = useGLTF('/models/scifi/Sword_Bronze.gltf');
  const weaponFantasySword = useGLTF('/models/fantasy/Sword_Bronze.gltf');
  const weaponFantasyAxe = useGLTF('/models/fantasy/Axe_Bronze.gltf');
  const weaponUmmPistol = useFBX('/models/umm-weapons/pistol.fbx');
  const { actions } = useAnimations(gltf.animations, gltf.scene);
  const fitGroupRef = useRef<THREE.Group>(null);
  const motionGroupRef = useRef<THREE.Group>(null);
  const prevHealthRef = useRef<number>(healthCurrent);
  const nextAttackAtRef = useRef<number>(preset.attackIntervalSec);
  const isAttackingRef = useRef<boolean>(false);
  const activeAttackRef = useRef<string | null>(null);
  const swordAttachedRef = useRef<boolean>(false);
  const hiddenHeadNodesRef = useRef<VisibilitySnapshot[]>([]);
  const defeated = healthCurrent <= 0;

  useLayoutEffect(() => {
    if (!fitGroupRef.current) return;
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 3.48 / maxDim;
    fitGroupRef.current.scale.setScalar(scale);
    fitGroupRef.current.position.set(-center.x * scale, -center.y * scale - 1.45, -0.8);
    swordAttachedRef.current = false;
  }, [gltf]);

  useEffect(() => {
    restoreNodes(hiddenHeadNodesRef.current);
    hiddenHeadNodesRef.current = [];
    removeNamedChild(gltf.scene, '__boss_head_swap__');

    if (preset.headVariant !== 'horse') return;

    const headTarget = findHeadTarget(gltf.scene);
    const parent = headTarget ?? gltf.scene;
    const headMeshes = collectHeadMeshes(gltf.scene, headTarget);
    const placementBox = getHeadPlacementBox(gltf.scene, headMeshes);
    if (!placementBox) return;

    hiddenHeadNodesRef.current = hideNodes(headMeshes);
    const horse = mountHorseHead({
      source: horseHead,
      parent,
      placementBox,
      nodeName: '__boss_head_swap__',
    });

    return () => {
      if (horse.parent) horse.parent.remove(horse);
      restoreNodes(hiddenHeadNodesRef.current);
      hiddenHeadNodesRef.current = [];
    };
  }, [gltf.scene, horseHead, preset.headVariant]);

  useEffect(() => {
    const idle = actions?.[preset.idleClip] ?? actions?.Idle_Neutral ?? actions?.Idle;
    const death = actions?.[preset.deathClip] ?? actions?.Death;
    if (!idle) return;

    idle.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.2).play();
    if (death) {
      death.stop();
    }

    return () => {
      idle.fadeOut(0.2);
      idle.stop();
      if (death) death.stop();
      const attackNames = preset.attackClips;
      attackNames.forEach((name) => actions?.[name]?.stop());
    };
  }, [actions, preset.attackClips, preset.deathClip, preset.idleClip]);

  useEffect(() => {
    const idle = actions?.[preset.idleClip] ?? actions?.Idle_Neutral ?? actions?.Idle;
    const hit = actions?.[preset.hitClip] ?? actions?.HitRecieve ?? actions?.HitRecieve_2;
    const death = actions?.[preset.deathClip] ?? actions?.Death;

    if (!idle) return;
    const prev = prevHealthRef.current;
    const dropped = healthCurrent < prev;

    if (defeated) {
      if (death) {
        idle.fadeOut(0.15);
        death.reset();
        death.setLoop(THREE.LoopOnce, 1);
        death.clampWhenFinished = true;
        death.fadeIn(0.12).play();
      }
      prevHealthRef.current = healthCurrent;
      return;
    }

    if (dropped && hit) {
      hit.reset();
      hit.setLoop(THREE.LoopOnce, 1);
      hit.clampWhenFinished = true;
      hit.fadeIn(0.08).play();

      window.setTimeout(() => {
        hit.fadeOut(0.12);
      }, 320);
    }

    prevHealthRef.current = healthCurrent;
  }, [actions, defeated, healthCurrent, healthMax, preset.deathClip, preset.hitClip, preset.idleClip]);

  useFrame(({ clock }) => {
    // Attach weapon on first frame when world matrices are ready
    if (!swordAttachedRef.current) {
      const attachTarget = findHandTarget(gltf.scene, preset.weaponId) ?? gltf.scene;
      const fallback = attachTarget === gltf.scene;

      if (attachTarget) {
        const existing = attachTarget.getObjectByName('__boss_sword__');
        if (existing) attachTarget.remove(existing);

        if (preset.weaponId !== 'none' && preset.weaponUrl) {
          let source: THREE.Object3D | null = null;
          if (preset.weaponId === 'sword_scifi') source = weaponSciFiSword.scene;
          if (preset.weaponId === 'sword_fantasy') source = weaponFantasySword.scene;
          if (preset.weaponId === 'axe_fantasy') source = weaponFantasyAxe.scene;
          if (preset.weaponId === 'pistol_umm') source = weaponUmmPistol;
          if (!source) {
            swordAttachedRef.current = true;
            return;
          }

          const weapon = source.clone();
          const transform = getWeaponTransform(preset.weaponId);
          const charBox = new THREE.Box3().setFromObject(gltf.scene);
          const charSize = charBox.getSize(new THREE.Vector3());
          const charHeight = Math.max(charSize.y, 1);
          const weaponBox = new THREE.Box3().setFromObject(weapon);
          const weaponSize = weaponBox.getSize(new THREE.Vector3());
          const weaponLen = Math.max(weaponSize.y, weaponSize.x, weaponSize.z, 0.01);
          const autoScale = (charHeight * 0.32) / weaponLen;

          weapon.name = '__boss_sword__';
          weapon.scale.setScalar(transform.scale * autoScale);
          weapon.rotation.copy(transform.rotation);
          weapon.position.copy(transform.position);

          weapon.updateMatrixWorld(true);
          const alignedBox = new THREE.Box3().setFromObject(weapon);
          const cx = (alignedBox.min.x + alignedBox.max.x) * 0.5;
          const cz = (alignedBox.min.z + alignedBox.max.z) * 0.5;
          const minY = alignedBox.min.y;
          const gripY = minY + (alignedBox.max.y - alignedBox.min.y) * getGripInset(preset.weaponId);
          weapon.position.x -= cx;
          weapon.position.z -= cz;
          weapon.position.y -= gripY;

          if (fallback) {
            weapon.position.set(0.6, 0.45, 0.25);
            weapon.rotation.set(0, -Math.PI / 2, Math.PI / 8);
          }
          weapon.traverse((obj) => {
            obj.frustumCulled = false;
          });
          attachTarget.add(weapon);
        }
        swordAttachedRef.current = true;
      }
    }

    if (!motionGroupRef.current) return;
    const t = clock.getElapsedTime();
    const sway = Math.sin(t * 0.55) * 0.02;
    const bob = Math.sin(t * 0.9) * 0.015;
    motionGroupRef.current.position.x = sway;
    motionGroupRef.current.position.y = bob;
    motionGroupRef.current.rotation.y = Math.sin(t * 0.35) * 0.05;

    const idle = actions?.[preset.idleClip] ?? actions?.Idle_Neutral ?? actions?.Idle;
    if (!idle) return;

    if (defeated) {
      if (activeAttackRef.current) {
        actions?.[activeAttackRef.current]?.stop();
        activeAttackRef.current = null;
      }
      isAttackingRef.current = false;
      return;
    }

    const attackCandidates = preset.attackClips
      .filter((name) => !!actions?.[name]);

    if (attackCandidates.length === 0) return;

    if (!isAttackingRef.current && t >= nextAttackAtRef.current) {
      const idx = Math.floor(Math.random() * attackCandidates.length);
      const attackName = attackCandidates[idx];
      const attackAction = actions?.[attackName];
      if (!attackAction) return;

      isAttackingRef.current = true;
      activeAttackRef.current = attackName;

      idle.fadeOut(0.1);
      attackAction.reset();
      attackAction.setLoop(THREE.LoopOnce, 1);
      attackAction.clampWhenFinished = true;
      attackAction.fadeIn(0.1).play();
      return;
    }

    if (isAttackingRef.current && activeAttackRef.current) {
      const attackAction = actions?.[activeAttackRef.current];
      if (!attackAction) {
        isAttackingRef.current = false;
        activeAttackRef.current = null;
        nextAttackAtRef.current = t + preset.attackIntervalSec;
        return;
      }

      const duration = attackAction.getClip().duration;
      if (attackAction.time >= duration - 0.03) {
        attackAction.fadeOut(0.08);
        attackAction.stop();
        idle.reset().fadeIn(0.12).play();
        isAttackingRef.current = false;
        activeAttackRef.current = null;
        nextAttackAtRef.current = t + preset.attackIntervalSec;
      }
    }
  });

  return (
    <group ref={motionGroupRef}>
      <group ref={fitGroupRef}>
        <primitive object={gltf.scene} />
      </group>
    </group>
  );
}

/* ── Emissive pulsing ring on the platform ─────────────────────────────── */

function ArenaRing() {
  const ringRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ringRef.current) return;
    const mat = ringRef.current.material as THREE.MeshStandardMaterial;
    const pulse = 0.3 + Math.sin(clock.getElapsedTime() * 1.2) * 0.2;
    mat.emissiveIntensity = pulse;
  });
  return (
    <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.28, -0.8]}>
      <ringGeometry args={[1.6, 1.75, 64]} />
      <meshStandardMaterial
        color="#03b2e6"
        emissive="#03b2e6"
        emissiveIntensity={0.4}
        transparent
        opacity={0.6}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/* ── Floating particles ────────────────────────────────────────────────── */

function Particles({ count = 40 }: { count?: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const data = useMemo(() => {
    return Array.from({ length: count }, () => ({
      x: (Math.random() - 0.5) * 8,
      y: Math.random() * 4 - 2,
      z: (Math.random() - 0.5) * 6 - 2,
      speed: 0.2 + Math.random() * 0.4,
      offset: Math.random() * Math.PI * 2,
    }));
  }, [count]);

  useFrame(({ clock }) => {
    if (!mesh.current) return;
    const t = clock.getElapsedTime();
    data.forEach((p, i) => {
      dummy.position.set(
        p.x + Math.sin(t * p.speed + p.offset) * 0.3,
        p.y + Math.sin(t * p.speed * 0.7 + p.offset) * 0.5,
        p.z
      );
      dummy.scale.setScalar(0.01 + Math.sin(t * p.speed + p.offset) * 0.005);
      dummy.updateMatrix();
      mesh.current!.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshStandardMaterial color="#4cc9f0" emissive="#03b2e6" emissiveIntensity={2} transparent opacity={0.6} />
    </instancedMesh>
  );
}

/* ── Preload assets ────────────────────────────────────────────────────── */

useGLTF.preload('/models/spacesuit.gltf');
useGLTF.preload('/models/adventurer.gltf');
useGLTF.preload('/models/casual_2.gltf');
useGLTF.preload('/models/king.gltf');
useGLTF.preload('/models/umm/beach.gltf');
useGLTF.preload('/models/umm/casual_hoodie.gltf');
useGLTF.preload('/models/umm/farmer.gltf');
useGLTF.preload('/models/umm/punk.gltf');
useGLTF.preload('/models/umm/suit.gltf');
useGLTF.preload('/models/umm/swat.gltf');
useGLTF.preload('/models/umm/worker.gltf');
useGLTF.preload('/models/scifi/Sword_Bronze.gltf');
useGLTF.preload('/models/fantasy/Sword_Bronze.gltf');
useGLTF.preload('/models/fantasy/Axe_Bronze.gltf');
useFBX.preload('/models/umm-weapons/pistol.fbx');
useFBX.preload('/models/horse_head.fbx');
useGLTF.preload('/models/scifi/Platform_Round1.gltf');
useGLTF.preload('/models/scifi/Column_Astra.gltf');
useGLTF.preload('/models/scifi/Prop_Computer.gltf');
useGLTF.preload('/models/scifi/Prop_Crate3.gltf');
useGLTF.preload('/models/scifi/Prop_Barrel_Large.gltf');
useGLTF.preload('/models/scifi/Prop_AccessPoint.gltf');
useGLTF.preload('/models/scifi/Door_Frame_A.gltf');
useGLTF.preload('/models/scifi/Prop_Chest.gltf');
useGLTF.preload('/models/scifi/Prop_Crate4.gltf');
useGLTF.preload('/models/scifi/Prop_Fan_Small.gltf');
useGLTF.preload('/models/scifi/Prop_Light_Corner.gltf');
useGLTF.preload('/models/scifi/Prop_Light_Floor.gltf');
useGLTF.preload('/models/scifi/Prop_Light_Wide.gltf');
useGLTF.preload('/models/scifi/Prop_Vent_Big.gltf');
useGLTF.preload('/models/scifi/Prop_Vent_Wide.gltf');
useGLTF.preload('/models/fantasy-props/Anvil.gltf');
useGLTF.preload('/models/fantasy-props/Bench.gltf');
useGLTF.preload('/models/fantasy-props/Barrel.gltf');
useGLTF.preload('/models/fantasy-props/Cabinet.gltf');
useGLTF.preload('/models/fantasy-props/Chandelier.gltf');
useGLTF.preload('/models/fantasy-props/Crate_Wooden.gltf');
useGLTF.preload('/models/fantasy-props/Lantern_Wall.gltf');
useGLTF.preload('/models/fantasy-props/Shield_Wooden.gltf');
useGLTF.preload('/models/fantasy-props/Torch_Metal.gltf');
useGLTF.preload('/models/fantasy-props/WeaponStand.gltf');

/* ── Exported Scene ────────────────────────────────────────────────────── */

export default function BossBattleScene3D({
  healthCurrent,
  healthMax,
  lobbyId,
  forcedBossId,
  sceneSettingsOverride,
}: {
  healthCurrent: number;
  healthMax: number;
  lobbyId?: string;
  forcedBossId?: BossId;
  sceneSettingsOverride?: BossSceneSettings;
}) {
  const [basePreset, setBasePreset] = React.useState<BossAnimationPreset>(DEFAULT_BOSS_PRESET);
  const [activeBossId, setActiveBossId] = React.useState<BossId>(BOSS_RANDOM_POOL[0].id);
  const [storedSceneSettings, setStoredSceneSettings] = React.useState<BossSceneSettings>(
    cloneBossSceneSettings(DEFAULT_BOSS_SCENE_SETTINGS)
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const parsed = safeParseBossPreset(window.localStorage.getItem(BOSS_PRESET_STORAGE_KEY));
    if (parsed) setBasePreset(parsed);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncSceneSettings = () => {
      setStoredSceneSettings(parseBossSceneSettings(window.localStorage.getItem(BOSS_SCENE_SETTINGS_STORAGE_KEY)));
    };

    syncSceneSettings();

    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== BOSS_SCENE_SETTINGS_STORAGE_KEY) return;
      syncSceneSettings();
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') syncSceneSettings();
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', syncSceneSettings);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', syncSceneSettings);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  useEffect(() => {
    if (forcedBossId) {
      setActiveBossId(forcedBossId);
      return;
    }
    const scopedLobbyId = (lobbyId || '').trim();
    if (!scopedLobbyId) {
      setActiveBossId(getRandomPoolMember().id);
      return;
    }

    const key = `${BOSS_LOBBY_CHARACTER_KEY_PREFIX}${scopedLobbyId}`;
    const saved = window.localStorage.getItem(key);
    if (saved && isPoolCharacterId(saved)) {
      setActiveBossId(saved);
      return;
    }

    const next = getRandomPoolMember().id;
    window.localStorage.setItem(key, next);
    setActiveBossId(next);
  }, [forcedBossId, lobbyId]);

  const activeBoss = useMemo(
    () => BOSS_RANDOM_POOL.find((entry) => entry.id === activeBossId) ?? BOSS_RANDOM_POOL[0],
    [activeBossId]
  );

  const sceneSettings = sceneSettingsOverride ?? storedSceneSettings;
  const activeBossSetting = sceneSettings[activeBoss.id] ?? DEFAULT_BOSS_SCENE_SETTINGS[activeBoss.id];

  const preset = useMemo<BossAnimationPreset>(() => {
    const validWeaponIds = new Set(WEAPON_ASSETS.map((w) => w.id));
    const weaponId = validWeaponIds.has(activeBoss.weaponId) ? activeBoss.weaponId : DEFAULT_BOSS_PRESET.weaponId;
    const weaponUrl = activeBoss.weaponUrl;
    const allowedAttackSet = new Set(BOSS_ATTACK_OPTIONS[activeBoss.id]);
    const attackClips = activeBossSetting.attackClips.filter((clip) => allowedAttackSet.has(clip));

    return {
      ...basePreset,
      characterId: activeBoss.id,
      modelUrl: activeBoss.modelUrl,
      weaponId,
      weaponUrl,
      idleClip: activeBossSetting.idleClip || basePreset.idleClip || 'Idle_Neutral',
      hitClip: activeBossSetting.hitClip || basePreset.hitClip || 'HitRecieve',
      deathClip: activeBossSetting.deathClip || basePreset.deathClip || 'Death',
      attackClips: attackClips.length > 0 ? attackClips : [...DEFAULT_BOSS_SCENE_SETTINGS[activeBoss.id].attackClips],
      attackIntervalSec: activeBossSetting.attackIntervalSec,
    };
  }, [activeBoss, activeBossSetting, basePreset]);

  const arenaLayout = useMemo(() => {
    const bossId = preset.characterId as BossId;
    const baseLayout = BOSS_ARENA_LAYOUTS[bossId] ?? BOSS_ARENA_LAYOUTS.spacesuit;
    return {
      fogColor: activeBossSetting.fogColor || baseLayout.fogColor,
      particleCount: activeBossSetting.particleCount,
      pieces: getArenaPiecesForVariant(bossId, baseLayout.pieces, activeBossSetting.backgroundVariant),
    };
  }, [activeBossSetting.backgroundVariant, activeBossSetting.fogColor, activeBossSetting.particleCount, preset.characterId]);
  const bossBackdropUrl =
    preset.characterId === 'spacesuit'
      ? '/backgrounds/space.png'
      : preset.characterId === 'swat'
        ? '/backgrounds/lab.png'
      : preset.characterId === 'punk'
        ? '/backgrounds/dungeon.png'
        : preset.characterId === 'suit'
          ? '/backgrounds/spacered.png'
        : null;
  const showSciFiArenaBase = preset.characterId !== 'punk';

  return (
    <div className="relative w-full h-full overflow-hidden bg-gradient-to-br from-slate-950 via-[#0a1628] to-slate-900">
      {bossBackdropUrl && (
        <div
          className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: `url('${bossBackdropUrl}')` }}
        />
      )}
      <div className="relative z-10 h-full w-full">
        <Canvas dpr={[1, 1.5]} gl={{ alpha: true }} camera={{ position: [0, 0.35, 4.6], fov: 33 }}>
          <ambientLight intensity={0.5} />
          <directionalLight position={[4, 5, 4]} intensity={1.4} />
          <directionalLight position={[-4, 2, -2]} intensity={0.6} color="#ff6b6b" />
          <directionalLight position={[0, -2, 4]} intensity={0.4} color="#03b2e6" />
          <pointLight position={[0, -1, 0]} intensity={0.8} color="#03b2e6" distance={6} decay={2} />
          <fog attach="fog" args={[arenaLayout.fogColor, 6, 18]} />

          <Suspense fallback={null}>
            {/* Boss */}
            <BossModel
              key={preset.characterId}
              healthCurrent={healthCurrent}
              healthMax={healthMax}
              preset={preset}
            />

            {/* Platform under the boss (hidden for punk to keep it fantasy-only). */}
            {showSciFiArenaBase && (
              <SciFiModel
                url="/models/scifi/Platform_Round1.gltf"
                position={[0, -2.3, -0.8]}
                scale={1.5}
              />
            )}

            {/* Boss-specific arena dressing; kept away from the center lane to avoid covering the boss. */}
            {arenaLayout.pieces.map((piece, idx) => (
              <SciFiModel
                key={`${preset.characterId}:${piece.url}:${idx}`}
                url={piece.url}
                position={piece.position}
                rotation={piece.rotation ?? [0, 0, 0]}
                scale={piece.scale ?? 1}
              />
            ))}

            {/* Emissive ring on the platform (hidden for punk to keep it fantasy-only). */}
            {showSciFiArenaBase && <ArenaRing />}

            {/* Floating particles for atmosphere */}
            <Particles count={arenaLayout.particleCount} />
          </Suspense>
        </Canvas>
      </div>
    </div>
  );
}
