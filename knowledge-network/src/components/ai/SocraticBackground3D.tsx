'use client';

import React, { Suspense, useEffect, useLayoutEffect, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useAnimations, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { TutorMarkdown } from '@/components/ai/TutorMarkdown';
import { Typewriter } from '@/components/ui/typewriter';

type CharacterModelProps = {
  isSpeaking: boolean;
};

function renderSpeechSections(
  text: string,
  onCitationClick?: (n: number, sectionIndex: number) => void,
  typingText?: string
): React.ReactNode {
  const sections = text.split(/\n?%%SEP%%\n?/);
  const animatedSectionIndex =
    typingText && sections[sections.length - 1] === typingText ? sections.length - 1 : -1;

  return sections.map((section, index) => {
    const isAnimatedSection = index === animatedSectionIndex && Boolean(typingText);
    return (
      <React.Fragment key={`${index}-${section.slice(0, 24)}`}>
        {index > 0 && <hr className="my-3 border-white/15" />}
        {isAnimatedSection && typingText ? (
          <div className="text-[14px] leading-snug text-white/95">
            <Typewriter
              text={typingText}
              speed={24}
              initialDelay={120}
              loop={false}
              cursorChar="_"
              cursorClassName="ml-1 text-[#8de7ff]"
            />
          </div>
        ) : (
          <TutorMarkdown
            content={section}
            onCitationClick={(n) => onCitationClick?.(n, index)}
            tone="dark"
            compact
            className="!prose-sm"
          />
        )}
      </React.Fragment>
    );
  });
}

function CharacterModel({ isSpeaking }: CharacterModelProps) {
  const gltf = useGLTF('/models/king.gltf');
  const { actions } = useAnimations(gltf.animations, gltf.scene);
  const fitGroupRef = useRef<THREE.Group>(null);
  const motionGroupRef = useRef<THREE.Group>(null);
  const headPitchRef = useRef(0);

  useEffect(() => {
    const idleNeutral = actions?.Idle_Neutral ?? actions?.Idle;
    if (!idleNeutral) return;

    idleNeutral.reset();
    idleNeutral.setLoop(THREE.LoopRepeat, Infinity);
    idleNeutral.clampWhenFinished = false;
    idleNeutral.fadeIn(0.25).play();

    return () => {
      idleNeutral.fadeOut(0.2);
      idleNeutral.stop();
    };
  }, [actions]);

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
    const breathe = 1 + Math.sin(t * 0.7) * 0.0005;
    const sway = Math.sin(t * 0.22) * 0.0006;
    const bob = Math.sin(t * 0.3) * 0.0005;

    motionGroupRef.current.position.x = sway;
    motionGroupRef.current.position.y = bob;
    motionGroupRef.current.rotation.y = Math.sin(t * 0.15) * 0.0025;
    motionGroupRef.current.scale.set(breathe, breathe, breathe);

    const targetPitch = isSpeaking ? Math.sin(t * 4.2) * 0.004 : 0;
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
  typingText,
  onCitationClick,
}: {
  speechText?: string;
  isSpeaking?: boolean;
  typingText?: string;
  onCitationClick?: (n: number, sectionIndex: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevSpeechTextRef = useRef('');

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (event: WheelEvent) => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const hasOverflow = scrollHeight > clientHeight;
      if (!hasOverflow) return;

      const atTop = scrollTop <= 0 && event.deltaY < 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1 && event.deltaY > 0;

      if (!atTop && !atBottom) {
        event.stopPropagation();
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [speechText]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (!speechText || speechText === prevSpeechTextRef.current) return;
    prevSpeechTextRef.current = speechText;

    requestAnimationFrame(() => {
      try {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      } catch {
        el.scrollTop = el.scrollHeight;
      }
    });
  }, [speechText]);

  return (
    <BackgroundErrorBoundary>
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

      {speechText ? (
        <div
          className="absolute left-1/2 z-20 w-[min(545px,calc(100vw-2rem))] -translate-x-1/2 pointer-events-auto"
          style={{ top: 'calc(14% + 8px)' }}
        >
          <div className="relative rounded-lg border border-white/20 bg-slate-900/60 px-3.5 py-3 text-white shadow-xl backdrop-blur-md">
            <div className="absolute left-1/2 top-full h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-white/20 bg-slate-900/60" />
            <div
              ref={scrollRef}
              className="overflow-y-auto pr-1"
              style={{
                minHeight: '100px',
                maxHeight: 'calc(46vh - 44px)',
                overscrollBehavior: 'contain',
                WebkitOverflowScrolling: 'touch',
                touchAction: 'pan-y',
              }}
            >
              {renderSpeechSections(speechText, onCitationClick, typingText)}
            </div>
          </div>
        </div>
      ) : null}
    </BackgroundErrorBoundary>
  );
}
