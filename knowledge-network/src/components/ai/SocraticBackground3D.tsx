'use client';

import React, { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

type CharacterModelProps = {
  isSpeaking: boolean;
};

/** Expand [N] citations in a single text segment. */
function inlineCitations(
  text: string,
  onCitationClick?: (n: number) => void
): React.ReactNode[] {
  if (!/\[\d+\]/.test(text)) return [text];
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

/** Split text on %%SEP%% markers (between assistant responses) and render <hr> dividers. */
function expandSpeechCitations(
  text: string,
  onCitationClick?: (n: number) => void
): React.ReactNode {
  const sections = text.split(/\n?%%SEP%%\n?/);
  if (sections.length <= 1) return inlineCitations(text, onCitationClick);
  return sections.map((section, i) => (
    <React.Fragment key={i}>
      {i > 0 && <hr className="my-2 border-slate-300" />}
      <span>{inlineCitations(section, onCitationClick)}</span>
    </React.Fragment>
  ));
}

function CharacterModel({ isSpeaking }: CharacterModelProps) {
  const gltf = useGLTF('/models/king.gltf');
  const fitGroupRef = useRef<THREE.Group>(null);
  const motionGroupRef = useRef<THREE.Group>(null);
  const headPitchRef = useRef(0);

  useLayoutEffect(() => {
    if (!fitGroupRef.current) return;

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

    motionGroupRef.current.position.x = sway;
    motionGroupRef.current.position.y = bob;
    motionGroupRef.current.rotation.y = Math.sin(t * 0.2) * 0.0049;
    motionGroupRef.current.scale.set(breathe, breathe, breathe);

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
  const scrollRef = useRef<HTMLDivElement>(null);

  const bubbleMaxHeight = useMemo(() => {
    const words = speechText.trim() ? speechText.trim().split(/\s+/).length : 0;
    const base = 240;
    const growth = Math.min(1, words / 120) * 0.2;
    return Math.round(base * (1 + growth));
  }, [speechText]);

  // Attach a non-passive native wheel listener so we can stopPropagation
  // and guarantee the scroll container scrolls on every browser/OS.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const hasOverflow = scrollHeight > clientHeight;
      if (!hasOverflow) return;

      const atTop = scrollTop <= 0 && e.deltaY < 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1 && e.deltaY > 0;

      if (!atTop && !atBottom) {
        e.stopPropagation();
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [speechText]); // re-attach when content changes

  return (
    <BackgroundErrorBoundary>
      {/* Canvas wrapper — pointer-events-none so it never steals events */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden>
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
            <CharacterModel isSpeaking={isSpeaking} />
          </Suspense>
        </Canvas>
      </div>

      {/* Speech bubble — plain HTML, z-20 to sit above all z-10 siblings in parent */}
      {speechText ? (
        <div className="absolute left-1/2 top-[18%] -translate-x-1/2 z-20 pointer-events-auto">
          <div className="relative w-[545px] rounded-lg border border-white/70 bg-white/95 px-3.5 py-3 text-[14px] leading-snug text-slate-900 shadow-xl backdrop-blur-sm">
            <div className="absolute left-1/2 top-full h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-white/70 bg-white/95" />
            <div
              ref={scrollRef}
              className="overflow-y-auto whitespace-pre-wrap pr-1"
              style={{
                maxHeight: `${bubbleMaxHeight}px`,
                overscrollBehavior: 'contain',
                WebkitOverflowScrolling: 'touch',  /* iOS Safari smooth scroll */
                touchAction: 'pan-y',               /* touch devices: allow vertical pan */
              }}
            >
              {expandSpeechCitations(speechText, onCitationClick)}
            </div>
          </div>
        </div>
      ) : null}
    </BackgroundErrorBoundary>
  );
}
