'use client';

import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { motion, type Variant } from 'framer-motion';

import { cn } from '@/lib/utils';

interface TypewriterProps {
  text: string | string[];
  speed?: number;
  initialDelay?: number;
  waitTime?: number;
  deleteSpeed?: number;
  loop?: boolean;
  className?: string;
  showCursor?: boolean;
  hideCursorOnType?: boolean;
  cursorChar?: string | ReactNode;
  cursorAnimationVariants?: {
    initial: Variant;
    animate: Variant;
  };
  cursorClassName?: string;
}

const defaultCursorAnimationVariants: NonNullable<TypewriterProps['cursorAnimationVariants']> = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: {
      duration: 0.01,
      repeat: Infinity,
      repeatDelay: 0.4,
      repeatType: 'reverse',
    },
  },
};

const Typewriter = ({
  text,
  speed = 50,
  initialDelay = 0,
  waitTime = 2000,
  deleteSpeed = 30,
  loop = true,
  className,
  showCursor = true,
  hideCursorOnType = false,
  cursorChar = '|',
  cursorClassName = 'ml-1',
  cursorAnimationVariants = defaultCursorAnimationVariants,
}: TypewriterProps) => {
  const textKey = useMemo(() => JSON.stringify(text), [text]);
  const texts = useMemo(() => {
    const values = Array.isArray(text) ? text : [text];
    return values.length > 0 ? values : [''];
  }, [textKey]);

  const [displayText, setDisplayText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [currentTextIndex, setCurrentTextIndex] = useState(0);

  useEffect(() => {
    setDisplayText('');
    setCurrentIndex(0);
    setIsDeleting(false);
    setCurrentTextIndex(0);
  }, [textKey]);

  useEffect(() => {
    const currentText = texts[currentTextIndex] ?? '';
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (!loop && currentTextIndex === texts.length - 1 && displayText === currentText && !isDeleting) {
      return;
    }

    if (isDeleting) {
      if (displayText.length === 0) {
        timeout = setTimeout(() => {
          setIsDeleting(false);
          setCurrentTextIndex((prev) => (prev + 1) % texts.length);
          setCurrentIndex(0);
        }, waitTime);
      } else {
        timeout = setTimeout(() => {
          const nextLength = Math.max(displayText.length - 1, 0);
          setDisplayText(currentText.slice(0, nextLength));
          setCurrentIndex(nextLength);
        }, deleteSpeed);
      }
    } else if (currentIndex < currentText.length) {
      timeout = setTimeout(() => {
        const nextLength = currentIndex + 1;
        setDisplayText(currentText.slice(0, nextLength));
        setCurrentIndex(nextLength);
      }, currentIndex === 0 ? initialDelay : speed);
    } else if (texts.length > 1 && (loop || currentTextIndex < texts.length - 1)) {
      timeout = setTimeout(() => {
        setIsDeleting(true);
      }, waitTime);
    }

    return () => {
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [
    currentIndex,
    currentTextIndex,
    deleteSpeed,
    displayText,
    initialDelay,
    isDeleting,
    loop,
    speed,
    texts,
    waitTime,
  ]);

  const isTyping = currentIndex < (texts[currentTextIndex]?.length ?? 0) || isDeleting;

  return (
    <span className={cn('inline whitespace-pre-wrap tracking-tight', className)}>
      <span>{displayText}</span>
      {showCursor && (
        <motion.span
          variants={cursorAnimationVariants}
          className={cn(cursorClassName, hideCursorOnType && isTyping ? 'hidden' : '')}
          initial="initial"
          animate="animate"
        >
          {cursorChar}
        </motion.span>
      )}
    </span>
  );
};

export { Typewriter };
