'use client';

import React, { Suspense, useEffect, useLayoutEffect, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useAnimations, useGLTF } from '@react-three/drei';
import * as THREE from 'three';

type CharacterModelProps = {
  isSpeaking: boolean;
};

/** Expand [N] citations in a single text segment. */
function inlineCitations(
  text: string,
  sectionIndex: number,
  onCitationClick?: (n: number, sectionIndex: number) => void
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
          onClick={() => onCitationClick?.(n, sectionIndex)}
          title={`Jump to source ${n}`}
        >
          {n}
        </sup>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

/**
 * Deduplicate citation markers in a single section of text.
 * - Single unique source → one footnote at the very end.
 * - Contiguous same-source runs → keep only the last citation in the run.
 */
function deduplicateSpeechCitations(content: string): string {
  const allCites = [...content.matchAll(/\[(\d+)\]/g)].map(m => Number(m[1]));
  if (allCites.length === 0) return content;

  const uniqueCites = new Set(allCites);
  if (uniqueCites.size === 1) {
    const n = allCites[0];
    return `${content.replace(/\s*\[\d+\]/g, '').trimEnd()} [${n}]`;
  }

  const sentencePattern = /([^.!?\n]+[.!?\n]+)/g;
  const sentences: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = sentencePattern.exec(content)) !== null) {
    sentences.push(match[1]);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) sentences.push(content.slice(lastIndex));
  if (sentences.length === 0) return content;

  const parsed = sentences.map(s => {
    const cites = [...s.matchAll(/\[(\d+)\]/g)].map(m => Number(m[1]));
    const stripped = s.replace(/\s*\[\d+\]/g, '');
    const source = cites.length > 0 ? cites[cites.length - 1] : null;
    return { text: stripped, source };
  });

  const result: string[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const curr = parsed[i];
    const next = i + 1 < parsed.length ? parsed[i + 1] : null;
    if (curr.source === null) {
      result.push(curr.text);
    } else if (next && next.source === curr.source) {
      result.push(curr.text);
    } else {
      result.push(`${curr.text.trimEnd()} [${curr.source}]`);
    }
  }
  return result.join('');
}

/** Split text on %%SEP%% markers (between assistant responses) and render <hr> dividers.
 *  Section index `i` is passed through to onCitationClick so callers know which
 *  message's [N] was clicked (section 0 = initial prompt, 1 = first assistant reply, …). */
function expandSpeechCitations(
  text: string,
  onCitationClick?: (n: number, sectionIndex: number) => void
): React.ReactNode {
  const sections = text.split(/\n?%%SEP%%\n?/);
  if (sections.length <= 1) {
    return inlineCitations(deduplicateSpeechCitations(text), 0, onCitationClick);
  }
  return sections.map((section, i) => (
    <React.Fragment key={i}>
      {i > 0 && <hr className="my-2 border-slate-300" />}
      <span>{inlineCitations(deduplicateSpeechCitations(section), i, onCitationClick)}</span>
    </React.Fragment>
  ));
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
  onCitationClick,
}: {
  speechText?: string;
  isSpeaking?: boolean;
  onCitationClick?: (n: number, sectionIndex: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevSpeechTextRef = useRef('');

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

  // Auto-scroll to the newest generated content whenever the assistant reply updates.
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

      {/* Speech bubble — top-anchored just below the header bar, grows DOWNWARD.
           top: calc(14% + 8px) clears the header (≈14% tall) with an 8px gap.
           The tail triangle points down toward the character's head.
           Scroll content is capped so the bubble never covers the character:
             maxHeight = 60vh(character head) − 14vh(top) − 8px(gap) − 24px(padding) − 12px(safety)
                       = calc(46vh − 44px) */}
      {speechText ? (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-20 pointer-events-auto"
          style={{ top: 'calc(14% + 8px)' }}
        >
          <div className="relative w-[545px] rounded-lg border border-white/20 bg-slate-900/60 px-3.5 py-3 text-[14px] leading-snug text-white shadow-xl backdrop-blur-md">
            {/* Tail triangle — points down toward the character's head */}
            <div className="absolute left-1/2 top-full h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-white/20 bg-slate-900/60" />
            <div
              ref={scrollRef}
              className="overflow-y-auto whitespace-pre-wrap pr-1"
              style={{
                minHeight: '100px',
                maxHeight: 'calc(46vh - 44px)',
                overscrollBehavior: 'contain',
                WebkitOverflowScrolling: 'touch',
                touchAction: 'pan-y',
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
