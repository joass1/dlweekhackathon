'use client';

import React, { Suspense, useEffect, useLayoutEffect, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useAnimations, useGLTF } from '@react-three/drei';
import * as THREE from 'three';

function BossModel({ healthCurrent, healthMax }: { healthCurrent: number; healthMax: number }) {
  const gltf = useGLTF('/models/spacesuit.gltf');
  const { actions } = useAnimations(gltf.animations, gltf.scene);
  const fitGroupRef = useRef<THREE.Group>(null);
  const motionGroupRef = useRef<THREE.Group>(null);
  const prevHealthRef = useRef<number>(healthCurrent);
  const nextAttackAtRef = useRef<number>(5);
  const isAttackingRef = useRef<boolean>(false);
  const activeAttackRef = useRef<string | null>(null);
  const defeated = healthCurrent <= 0;

  useLayoutEffect(() => {
    if (!fitGroupRef.current) return;
    // Fit against the base spacesuit model so head-swaps do not throw off framing.
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    // 20% bigger than the previous stable size.
    const scale = 3.48 / maxDim;
    fitGroupRef.current.scale.setScalar(scale);
    // Move the whole boss upward by ~20%.
    fitGroupRef.current.position.set(-center.x * scale, -center.y * scale - 1.04, -0.8);
  }, [gltf]);

  useEffect(() => {
    const idle = actions?.Idle_Neutral ?? actions?.Idle;
    const death = actions?.Death;
    if (!idle) return;

    idle.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.2).play();
    if (death) {
      death.stop();
    }

    return () => {
      idle.fadeOut(0.2);
      idle.stop();
      if (death) death.stop();
      const attackNames = ['Sword_Slash', 'Punch_Left', 'Punch_Right', 'Kick_Left', 'Kick_Right', 'Gun_Shoot', 'Run_Shoot'];
      attackNames.forEach((name) => actions?.[name]?.stop());
    };
  }, [actions]);

  useEffect(() => {
    const idle = actions?.Idle_Neutral ?? actions?.Idle;
    const hit = actions?.HitRecieve ?? actions?.HitRecieve_2;
    const death = actions?.Death;

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
  }, [actions, defeated, healthCurrent, healthMax]);

  useFrame(({ clock }) => {
    if (!motionGroupRef.current) return;
    const t = clock.getElapsedTime();
    const sway = Math.sin(t * 0.55) * 0.02;
    const bob = Math.sin(t * 0.9) * 0.015;
    motionGroupRef.current.position.x = sway;
    motionGroupRef.current.position.y = bob;
    motionGroupRef.current.rotation.y = Math.sin(t * 0.35) * 0.05;

    const idle = actions?.Idle_Neutral ?? actions?.Idle;
    if (!idle) return;

    if (defeated) {
      if (activeAttackRef.current) {
        actions?.[activeAttackRef.current]?.stop();
        activeAttackRef.current = null;
      }
      isAttackingRef.current = false;
      return;
    }

    const attackCandidates = ['Sword_Slash', 'Punch_Left', 'Punch_Right', 'Kick_Left', 'Kick_Right', 'Gun_Shoot', 'Run_Shoot']
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
        nextAttackAtRef.current = t + 5;
        return;
      }

      const duration = attackAction.getClip().duration;
      if (attackAction.time >= duration - 0.03) {
        attackAction.fadeOut(0.08);
        attackAction.stop();
        idle.reset().fadeIn(0.12).play();
        isAttackingRef.current = false;
        activeAttackRef.current = null;
        nextAttackAtRef.current = t + 5;
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

useGLTF.preload('/models/spacesuit.gltf');

export default function BossBattleScene3D({
  healthCurrent,
  healthMax,
}: {
  healthCurrent: number;
  healthMax: number;
}) {
  return (
    <div className="h-72 w-full rounded-xl overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 border border-red-300/30">
      <Canvas dpr={[1, 1.5]} gl={{ alpha: true }} camera={{ position: [0, 0.35, 4.6], fov: 33 }}>
        <ambientLight intensity={0.9} />
        <directionalLight position={[4, 5, 4]} intensity={1.25} />
        <directionalLight position={[-4, 2, -2]} intensity={0.55} color="#ff6b6b" />
        <Suspense fallback={null}>
          <BossModel healthCurrent={healthCurrent} healthMax={healthMax} />
        </Suspense>
      </Canvas>
    </div>
  );
}
