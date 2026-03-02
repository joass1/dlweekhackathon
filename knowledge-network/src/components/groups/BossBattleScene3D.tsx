'use client';

import React, { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useAnimations, useFBX, useGLTF } from '@react-three/drei';
import * as THREE from 'three';

function BossModel({ healthCurrent, healthMax }: { healthCurrent: number; healthMax: number }) {
  const gltf = useGLTF('/models/spacesuit.gltf');
  const horseHead = useFBX('/models/horse_head.fbx') as THREE.Group;
  const horseHeadClone = useMemo(() => horseHead.clone(true), [horseHead]);
  const { actions } = useAnimations(gltf.animations, gltf.scene);
  const fitGroupRef = useRef<THREE.Group>(null);
  const motionGroupRef = useRef<THREE.Group>(null);
  const prevHealthRef = useRef<number>(healthCurrent);
  const defeated = healthCurrent <= 0;

  useLayoutEffect(() => {
    if (!fitGroupRef.current) return;
    const box = new THREE.Box3().setFromObject(fitGroupRef.current);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 2.5 / maxDim;
    fitGroupRef.current.scale.setScalar(scale);
    fitGroupRef.current.position.set(-center.x * scale, -center.y * scale - 1.65, -1.2);
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
  });

  return (
    <group ref={motionGroupRef}>
      <group ref={fitGroupRef}>
        <primitive object={gltf.scene} />
        <group position={[0, 1.55, 0.08]} rotation={[0, Math.PI, 0]} scale={[0.012, 0.012, 0.012]}>
          <primitive object={horseHeadClone} />
        </group>
      </group>
    </group>
  );
}

useGLTF.preload('/models/spacesuit.gltf');
useFBX.preload('/models/horse_head.fbx');

export default function BossBattleScene3D({
  healthCurrent,
  healthMax,
}: {
  healthCurrent: number;
  healthMax: number;
}) {
  return (
    <div className="h-44 w-full rounded-xl overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 border border-red-300/30">
      <Canvas dpr={[1, 1.5]} gl={{ alpha: true }} camera={{ position: [0, 0.6, 5.2], fov: 35 }}>
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
