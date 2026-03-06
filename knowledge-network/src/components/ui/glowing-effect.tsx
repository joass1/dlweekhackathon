"use client";

import { memo, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface GlowingEffectProps {
  spread?: number;
  proximity?: number;
  inactiveZone?: number;
  glow?: boolean;
  className?: string;
  disabled?: boolean;
  borderWidth?: number;
  variant?: "default" | "cyan";
}

const GlowingEffect = memo(
  ({
    spread = 200,
    proximity = 80,
    inactiveZone = 0.01,
    glow = false,
    className,
    disabled = false,
    borderWidth = 2,
    variant = "default",
  }: GlowingEffectProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const glowRef = useRef<HTMLDivElement>(null);

    const handleMove = useCallback(
      (e: PointerEvent) => {
        if (!containerRef.current || !glowRef.current || disabled) return;

        const rect = containerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const isNear =
          e.clientX > rect.left - proximity &&
          e.clientX < rect.right + proximity &&
          e.clientY > rect.top - proximity &&
          e.clientY < rect.bottom + proximity;

        if (isNear) {
          glowRef.current.style.opacity = "1";
          glowRef.current.style.background = variant === "cyan"
            ? `radial-gradient(${spread}px circle at ${x}px ${y}px, rgba(3,178,230,0.45), rgba(76,201,240,0.2) 40%, transparent 70%)`
            : `radial-gradient(${spread}px circle at ${x}px ${y}px, rgba(221,123,187,0.4), rgba(215,159,30,0.25) 30%, rgba(90,146,44,0.2) 50%, transparent 70%)`;
        } else {
          glowRef.current.style.opacity = "0";
        }
      },
      [disabled, proximity, spread, variant]
    );

    useEffect(() => {
      if (disabled) return;

      const onPointerMove = (e: PointerEvent) => handleMove(e);
      const onPointerLeave = () => {
        if (glowRef.current) glowRef.current.style.opacity = "0";
      };

      document.body.addEventListener("pointermove", onPointerMove, { passive: true });
      document.body.addEventListener("pointerleave", onPointerLeave);

      return () => {
        document.body.removeEventListener("pointermove", onPointerMove);
        document.body.removeEventListener("pointerleave", onPointerLeave);
      };
    }, [handleMove, disabled]);

    return (
      <div
        ref={containerRef}
        className={cn(
          "pointer-events-none absolute inset-0 rounded-[inherit] overflow-hidden",
          disabled && "hidden",
          className
        )}
      >
        {/* Inner glow that follows cursor */}
        <div
          ref={glowRef}
          className="absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300"
        />
        {/* Border glow ring */}
        <div
          className="absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300"
          style={{
            boxShadow: variant === "cyan"
              ? `inset 0 0 0 ${borderWidth}px rgba(3,178,230,0.35), 0 0 15px rgba(3,178,230,0.15)`
              : `inset 0 0 0 ${borderWidth}px rgba(221,123,187,0.3), 0 0 15px rgba(221,123,187,0.1)`,
          }}
          data-glow-border=""
        />
      </div>
    );
  }
);

GlowingEffect.displayName = "GlowingEffect";

export { GlowingEffect };
