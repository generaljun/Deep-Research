import React, { useEffect, useState, useRef } from 'react';

interface AnimatedCharactersProps {
  isPasswordFocused?: boolean;
  isPasswordVisible?: boolean;
  typingLength?: number;
}

const AnimatedCharacters: React.FC<AnimatedCharactersProps> = ({
  isPasswordFocused = false,
  isPasswordVisible = false,
  typingLength = 0,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        // Calculate normalized mouse position relative to the center of the container
        // Values from -1 to 1
        const x = Math.max(-1, Math.min(1, (e.clientX - (rect.left + rect.width / 2)) / (window.innerWidth / 2)));
        const y = Math.max(-1, Math.min(1, (e.clientY - (rect.top + rect.height / 2)) / (window.innerHeight / 2)));
        setMousePos({ x, y });
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Calculate pupil offset based on mouse position or typing
  const getPupilOffset = () => {
    if (isPasswordFocused && !isPasswordVisible) {
      // Look up or away when password is focused and hidden
      return { x: 0, y: -8 };
    }
    if (typingLength > 0 && !isPasswordFocused) {
      // Look at the input field (assuming it's to the right and slightly down)
      // The more they type, the more the eyes move right
      const xOffset = Math.min(8, typingLength * 0.5);
      return { x: xOffset, y: 2 };
    }
    
    // Follow mouse
    return {
      x: mousePos.x * 8,
      y: mousePos.y * 8
    };
  };

  const pupilOffset = getPupilOffset();

  // Hands covering eyes when password is focused and hidden
  const showHands = isPasswordFocused && !isPasswordVisible;

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[400px] flex items-center justify-center bg-indigo-50 dark:bg-slate-900/50 rounded-3xl overflow-hidden">
      {/* Character 1: The Blue Monster */}
      <div className="relative z-10 transform scale-125 transition-transform duration-500 hover:scale-150">
        <svg width="200" height="200" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Body */}
          <path d="M40 180C40 100 60 40 100 40C140 40 160 100 160 180" fill="#3B82F6" />
          
          {/* Ears/Horns */}
          <path d="M40 80L20 40L60 60" fill="#2563EB" />
          <path d="M160 80L180 40L140 60" fill="#2563EB" />

          {/* Left Eye Background */}
          <circle cx="75" cy="90" r="20" fill="white" />
          {/* Right Eye Background */}
          <circle cx="125" cy="90" r="20" fill="white" />

          {/* Left Pupil */}
          <circle 
            cx={75 + pupilOffset.x} 
            cy={90 + pupilOffset.y} 
            r="8" 
            fill="#1E40AF" 
            className="transition-all duration-100 ease-out"
          />
          {/* Right Pupil */}
          <circle 
            cx={125 + pupilOffset.x} 
            cy={90 + pupilOffset.y} 
            r="8" 
            fill="#1E40AF" 
            className="transition-all duration-100 ease-out"
          />

          {/* Mouth */}
          {isPasswordFocused && !isPasswordVisible ? (
            // Nervous mouth
            <path d="M85 130 Q100 120 115 130" stroke="#1E3A8A" strokeWidth="4" strokeLinecap="round" fill="none" />
          ) : typingLength > 0 ? (
            // O-shaped mouth when typing
            <circle cx="100" cy="130" r="8" fill="#1E3A8A" />
          ) : (
            // Smile
            <path d="M80 125 Q100 145 120 125" stroke="#1E3A8A" strokeWidth="4" strokeLinecap="round" fill="none" />
          )}

          {/* Hands covering eyes */}
          <g className={`transition-all duration-300 ease-in-out origin-bottom ${showHands ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}>
            {/* Left Hand */}
            <path d="M40 140 Q60 80 85 90" stroke="#2563EB" strokeWidth="16" strokeLinecap="round" fill="none" />
            <circle cx="85" cy="90" r="12" fill="#2563EB" />
            
            {/* Right Hand */}
            <path d="M160 140 Q140 80 115 90" stroke="#2563EB" strokeWidth="16" strokeLinecap="round" fill="none" />
            <circle cx="115" cy="90" r="12" fill="#2563EB" />
          </g>
        </svg>
      </div>

      {/* Decorative background elements */}
      <div className="absolute top-10 left-10 w-20 h-20 bg-blue-400/20 rounded-full blur-xl animate-pulse"></div>
      <div className="absolute bottom-10 right-10 w-32 h-32 bg-indigo-400/20 rounded-full blur-xl animate-pulse" style={{ animationDelay: '1s' }}></div>
    </div>
  );
};

export default AnimatedCharacters;
