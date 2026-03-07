'use client';

import React, { Suspense, useEffect, useLayoutEffect, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useAnimations, useGLTF } from '@react-three/drei';
import * as THREE from 'three';

function AdventurerModel() {
  const gltf = useGLTF('/models/adventurer.gltf');
  const { actions } = useAnimations(gltf.animations, gltf.scene);
  const fitGroupRef = useRef<THREE.Group>(null);
  const motionGroupRef = useRef<THREE.Group>(null);
  const isWavingRef = useRef(false);
  const shouldWaveRef = useRef(false);

  useLayoutEffect(() => {
    if (!fitGroupRef.current) return;

    const box = new THREE.Box3().setFromObject(fitGroupRef.current);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const targetSize = 2.64;
    const scale = targetSize / maxDim;

    fitGroupRef.current.scale.setScalar(scale);
    fitGroupRef.current.position.set(-center.x * scale + 0.42, -center.y * scale - 0.95, -1.2);
  }, [gltf]);

  useEffect(() => {
    const idle = actions?.Idle_Neutral ?? actions?.Idle;
    const wave = actions?.Wave;
    if (!idle) return;

    idle.reset();
    idle.setLoop(THREE.LoopRepeat, Infinity);
    idle.clampWhenFinished = false;
    idle.fadeIn(0.2).play();
    isWavingRef.current = false;
    shouldWaveRef.current = false;

    if (wave) {
      wave.reset();
      wave.enabled = true;
      wave.setLoop(THREE.LoopOnce, 1);
      wave.clampWhenFinished = true;
      wave.stop();
    }

    return () => {
      idle.fadeOut(0.2);
      idle.stop();
      if (wave) {
        wave.fadeOut(0.2);
        wave.stop();
      }
    };
  }, [actions]);

  useFrame(({ clock }) => {
    if (!motionGroupRef.current) return;
    const t = clock.getElapsedTime();
    const idle = actions?.Idle_Neutral ?? actions?.Idle;
    const wave = actions?.Wave;
    const breathe = 1 + Math.sin(t * 0.9) * 0.001;
    const sway = Math.sin(t * 0.3) * 0.0012;
    const bob = Math.sin(t * 0.45) * 0.001;

    motionGroupRef.current.position.x = sway;
    motionGroupRef.current.position.y = bob;
    motionGroupRef.current.rotation.y = Math.sin(t * 0.22) * 0.004;
    motionGroupRef.current.scale.set(breathe, breathe, breathe);

    if (!idle || !wave) return;

    if (!isWavingRef.current && shouldWaveRef.current) {
      shouldWaveRef.current = false;
      isWavingRef.current = true;
      idle.fadeOut(0.15);
      wave.reset();
      wave.fadeIn(0.15).play();
      return;
    }

    if (isWavingRef.current) {
      const duration = wave.getClip().duration;
      if (wave.time >= duration - 0.03) {
        wave.stop();
        idle.reset().fadeIn(0.15).play();
        isWavingRef.current = false;
      }
    }
  });

  return (
    <group>
      <group ref={motionGroupRef}>
        <group
          ref={fitGroupRef}
          onPointerEnter={(event) => {
            event.stopPropagation();
            if (isWavingRef.current || shouldWaveRef.current) return;
            shouldWaveRef.current = true;
          }}
        >
          <primitive object={gltf.scene} />
        </group>
      </group>
    </group>
  );
}

useGLTF.preload('/models/adventurer.gltf');

function AnimatedAccentLight() {
  const lightRef = useRef<THREE.DirectionalLight>(null);

  useFrame(({ clock }) => {
    if (!lightRef.current) return;
    const t = clock.getElapsedTime();
    lightRef.current.intensity = 0.5 + (Math.sin(t * 1.1) + 1) * 0.15;
  });

  return <directionalLight ref={lightRef} position={[-4, 2, -2]} intensity={0.55} color="#90caf9" />;
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: unknown) {
    console.error('Upload 3D character failed:', error);
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

interface UploadCharacter3DProps {
  className?: string;
}

export default function UploadCharacter3D({ className }: UploadCharacter3DProps) {
  return (
    <ErrorBoundary>
      <div className={className ?? 'w-full h-[340px] pointer-events-auto'} aria-hidden>
        <Canvas
          dpr={[1, 1.5]}
          gl={{ alpha: true }}
          camera={{ position: [0, 0.75, 6], fov: 35 }}
          style={{ pointerEvents: 'auto' }}
        >
          <ambientLight intensity={0.9} />
          <directionalLight position={[4, 5, 4]} intensity={1.25} />
          <AnimatedAccentLight />

          <Suspense fallback={null}>
            <AdventurerModel />
          </Suspense>
        </Canvas>
      </div>
    </ErrorBoundary>
  );
}
