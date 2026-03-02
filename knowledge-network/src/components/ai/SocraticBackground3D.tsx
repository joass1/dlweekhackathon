'use client';

import React, { Suspense, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import * as THREE from 'three';

type CharacterModelProps = {
  speechText: string;
  isSpeaking: boolean;
  onCitationClick?: (n: number) => void;
};

/** Split text on [N] citation markers and render clickable superscript badges. */
function expandSpeechCitations(
  text: string,
  onCitationClick?: (n: number) => void
): React.ReactNode {
  if (!/\[\d+\]/.test(text)) return text;
  const parts = text.split(/(\[\d+\])/);
  return parts.map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    if (m) {
      const n = Number(m[1]);
      return (
        <sup
          key={i}
          className="cursor-pointer inline-flex items-center justify-center w-4 h-4 text-[0.6em] font-bold text-white bg-[#03b2e6] hover:bg-[#0291be] rounded-full ml-0.5 mr-0.5 transition-colors"
          onClick={() => onCitationClick?.(n)}
          title={`Jump to source ${n}`}
        >
          {n}
        </sup>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

function CharacterModel({
  speechText,
  isSpeaking,
  onCitationClick,
}: CharacterModelProps) {
  const gltf = useGLTF('/models/king.gltf');
  const fitGroupRef = useRef<THREE.Group>(null);
  const motionGroupRef = useRef<THREE.Group>(null);
  const headPitchRef = useRef(0);

  const bubbleMaxHeight = useMemo(() => {
    const words = speechText.trim() ? speechText.trim().split(/\s+/).length : 0;
    const base = 240;
    // Gradually expand up to +20% (vertical) for longer AI responses.
    const growth = Math.min(1, words / 120) * 0.2;
    return Math.round(base * (1 + growth));
  }, [speechText]);

  useLayoutEffect(() => {
    if (!fitGroupRef.current) return;

    // Normalize model size and center so it is reliably visible in camera.
    const box = new THREE.Box3().setFromObject(fitGroupRef.current);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const targetSize = 2.62;
    const scale = targetSize / maxDim;

    fitGroupRef.current.scale.setScalar(scale);
    fitGroupRef.current.position.set(-center.x * scale, -center.y * scale - 1.753, -1.45);
  }, [gltf]);

  useFrame(({ clock }, delta) => {
    if (!motionGroupRef.current) return;
    const t = clock.getElapsedTime();
    const breathe = 1 + Math.sin(t * 1.0) * 0.001225;
    const sway = Math.sin(t * 0.45) * 0.00147;
    const bob = Math.sin(t * 0.65) * 0.001225;

    // Keep idle subtle so the character is mostly stable.
    motionGroupRef.current.position.x = sway;
    motionGroupRef.current.position.y = bob;
    motionGroupRef.current.rotation.y = Math.sin(t * 0.2) * 0.0049;
    motionGroupRef.current.scale.set(breathe, breathe, breathe);

    // Add a light talking nod when speech bubble is visible.
    const targetPitch = isSpeaking ? Math.sin(t * 4.8) * 0.00343 : 0;
    headPitchRef.current += (targetPitch - headPitchRef.current) * Math.min(1, delta * 8);
    motionGroupRef.current.rotation.x = headPitchRef.current;
  });

  return (
    <group>
      <group ref={motionGroupRef}>
        <group ref={fitGroupRef}>
          <primitive object={gltf.scene} />
        </group>
      </group>
      {speechText ? (
        <Html position={[0.02, 0.63, 0.12]} center style={{ pointerEvents: 'auto' }}>
          <div
            className="pointer-events-auto relative w-[545px] rounded-lg border border-white/70 bg-white/95 px-3.5 py-3 text-[14px] leading-snug text-slate-900 shadow-xl backdrop-blur-sm"
          >
            <div className="absolute left-1/2 top-full h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-white/70 bg-white/95" />
            <div className="overflow-y-auto whitespace-pre-wrap pr-0.5 touch-pan-y" style={{ maxHeight: `${bubbleMaxHeight}px` }}>
              {expandSpeechCitations(speechText, onCitationClick)}
            </div>
          </div>
        </Html>
      ) : null}
    </group>
  );
}

useGLTF.preload('/models/king.gltf');

function StaticFallback() {
  return <div className="absolute inset-0" aria-hidden />;
}

class BackgroundErrorBoundary extends React.Component<
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
    console.error('Socratic 3D background failed, using static fallback.', error);
  }

  render() {
    if (this.state.hasError) return <StaticFallback />;
    return this.props.children;
  }
}

function AnimatedAccentLight() {
  const accentLightRef = useRef<THREE.DirectionalLight>(null);

  useFrame(({ clock }) => {
    if (!accentLightRef.current) return;
    const t = clock.getElapsedTime();
    accentLightRef.current.intensity = 0.5 + (Math.sin(t * 1.1) + 1) * 0.15;
  });

  return <directionalLight ref={accentLightRef} position={[-4, 2, -2]} intensity={0.55} color="#90caf9" />;
}

export default function SocraticBackground3D({
  speechText = '',
  isSpeaking = false,
  onCitationClick,
}: {
  speechText?: string;
  isSpeaking?: boolean;
  onCitationClick?: (n: number) => void;
}) {
  return (
    <BackgroundErrorBoundary>
      <div className="absolute inset-0" aria-hidden>
        <Canvas
          dpr={[1, 1.5]}
          gl={{ alpha: true }}
          camera={{ position: [0, 0.5, 6], fov: 35 }}
          fallback={<StaticFallback />}
          style={{ pointerEvents: 'none' }}
        >
          <ambientLight intensity={0.9} />
          <directionalLight position={[4, 5, 4]} intensity={1.25} />
          <AnimatedAccentLight />

          <Suspense fallback={null}>
            <CharacterModel
              speechText={speechText}
              isSpeaking={isSpeaking}
              onCitationClick={onCitationClick}
            />
          </Suspense>
        </Canvas>
      </div>
    </BackgroundErrorBoundary>
  );
}
