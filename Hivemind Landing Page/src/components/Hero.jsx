import React, { useRef } from 'react';
import BrainCanvas from './BrainModel'; // Adjust the import path as needed

// Basic Section component
const Section = ({ children, className = '', id }) => (
  <section id={id} className={`relative ${className}`}>
    {children}
  </section>
);

// Button Component
const Button = ({ children, href, white }) => (
  <a
    href={href}
    className={`inline-flex items-center justify-center px-6 py-3 rounded-full text-base font-semibold transition-colors
      ${white ? 'bg-white text-gray-900 hover:bg-gray-100' : 'bg-violet-500 text-white hover:bg-violet-600'}`}
  >
    {children}
  </a>
);

// Highlighted Text Component
const HighlightedText = ({ children }) => (
  <span className="relative inline-block">
    <span className="relative z-10">{children}</span>
    <span className="absolute inset-0 bg-gradient-to-r from-yellow-500 to-yellow-500 bg-[length:200%_100%] -rotate-2 translate-y-2 rounded animate-highlighter" 
      style={{
        animation: 'highlighter 2s cubic-bezier(0.4, 0, 0.2, 1)',
        animationFillMode: 'forwards'
      }}
    />
    <style jsx global>{`
      @keyframes highlighter {
        0% {
          clip-path: inset(0 100% 0 0);
        }
        100% {
          clip-path: inset(0 0 0 0);
        }
      }
    `}</style>
  </span>
 );
 
 const Hero = () => {
  const parallaxRef = useRef(null);
 
  return (
    <Section className="pt-30 -mt-20" id="hero">
      <div className="container relative mx-auto px-4" ref={parallaxRef}>
        <div className="relative z-10 max-w-4xl mx-auto text-center mb-16 md:mb-20 lg:mb-24">
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-white mb-6">
            Discover the Possibilities of&nbsp;Peer-to-Peer&nbsp;Education with{' '}
            <HighlightedText>Hivemind</HighlightedText>
          </h1>
          <p className="text-xl text-gray-300 max-w-3xl mx-auto mb-6 lg:mb-8">
            Unleash the power of AI within Hivemind. Supercharge your knowledge
            with Hivemind, the Agentic AI learning app.
          </p>
          <Button href="/pricing" white>
            Get started
          </Button>
        </div>
        <div className="relative max-w-[23rem] mx-auto md:max-w-5xl -mt-10 md:-mt-16 lg:-mt-24">
          <BrainCanvas />
        </div>
      </div>
    </Section>
  );
 };
 
 export default Hero;