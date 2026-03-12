import React, { useEffect, useState, useRef } from 'react';

interface AnimatedCharactersProps {
  isUsernameFocused?: boolean;
  isPasswordFocused?: boolean;
  isPasswordVisible?: boolean;
  isTyping?: boolean;
  isError?: boolean;
  isSuccess?: boolean;
  isButtonHovered?: boolean;
  typingLength?: number;
}

const AnimatedCharacters: React.FC<AnimatedCharactersProps> = ({
  isUsernameFocused = false,
  isPasswordFocused = false,
  isPasswordVisible = false,
  isTyping = false,
  isError = false,
  isSuccess = false,
  isButtonHovered = false,
  typingLength = 0,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Mouse tracking state
  const [mousePos, setMousePos] = useState({ x: 0, y: 0, dist: 1000, angle: 0 });
  const [isIdle, setIsIdle] = useState(false);
  const [idleLevel, setIdleLevel] = useState(0); // 0: active, 1: >5s, 2: >30s
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const deepIdleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [randomAction, setRandomAction] = useState<{ type: string, target?: string } | null>(null);

  // Blinking state
  const [blinking, setBlinking] = useState({ blue: false, green: false, orange: false });

  // Handle mouse movement
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const dx = e.clientX - centerX;
        const dy = e.clientY - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);
        
        // Normalize for pupil movement (-1 to 1)
        const nx = Math.max(-1, Math.min(1, dx / 300));
        const ny = Math.max(-1, Math.min(1, dy / 300));
        
        setMousePos({ x: nx, y: ny, dist, angle });
        
        // Reset idle timers
        setIsIdle(false);
        setIdleLevel(0);
        setRandomAction(null);
        
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        if (deepIdleTimerRef.current) clearTimeout(deepIdleTimerRef.current);
        
        idleTimerRef.current = setTimeout(() => {
          setIsIdle(true);
          setIdleLevel(1);
        }, 5000);
        
        deepIdleTimerRef.current = setTimeout(() => {
          setIdleLevel(2);
        }, 30000);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    
    // Initial idle timers
    idleTimerRef.current = setTimeout(() => { setIsIdle(true); setIdleLevel(1); }, 5000);
    deepIdleTimerRef.current = setTimeout(() => setIdleLevel(2), 30000);
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (deepIdleTimerRef.current) clearTimeout(deepIdleTimerRef.current);
    };
  }, []);

  // Random blinking
  useEffect(() => {
    const blinkInterval = setInterval(() => {
      const char = ['blue', 'green', 'orange'][Math.floor(Math.random() * 3)] as 'blue' | 'green' | 'orange';
      setBlinking(prev => ({ ...prev, [char]: true }));
      setTimeout(() => {
        setBlinking(prev => ({ ...prev, [char]: false }));
      }, 150);
    }, 3000 + Math.random() * 2000);
    
    return () => clearInterval(blinkInterval);
  }, []);

  // Idle random actions
  useEffect(() => {
    if (idleLevel === 1) {
      const actionInterval = setInterval(() => {
        setRandomAction({ type: 'look_around' });
        setTimeout(() => setRandomAction(null), 2500);
      }, 10000);
      return () => clearInterval(actionInterval);
    } else if (idleLevel === 2) {
      const actionInterval = setInterval(() => {
        const target = ['blue', 'green', 'orange'][Math.floor(Math.random() * 3)];
        setRandomAction({ type: 'yawn', target });
        setTimeout(() => setRandomAction(null), 2000);
      }, 15000);
      return () => clearInterval(actionInterval);
    }
  }, [idleLevel]);

  // Derived states for animation
  const isPasswordHidden = isPasswordFocused && !isPasswordVisible;
  const isPasswordShown = isPasswordFocused && isPasswordVisible;
  const isAccountError = isError && isUsernameFocused; // Simplified assumption
  const isLoginError = isError && !isUsernameFocused;

  // Character Component
  const Character = ({ 
    id, 
    baseColor, 
    gradColor, 
    scale, 
    tilt, 
    zIndex, 
    delay,
    type 
  }: { 
    id: 'blue' | 'green' | 'orange', 
    baseColor: string, 
    gradColor: string, 
    scale: number, 
    tilt: number, 
    zIndex: number,
    delay: number,
    type: 'round' | 'tall' | 'short'
  }) => {
    
    // Calculate dynamic transforms
    let bodyTransform = `scale(${scale}) rotate(${tilt}deg)`;
    let headTransform = '';
    let pupilX = mousePos.x * 12;
    let pupilY = mousePos.y * 12;
    let isBlinking = blinking[id];
    let mouthType = 'smile';
    let showHands = false;
    let showConfused = false;
    let showCheer = false;
    let showYawn = randomAction?.type === 'yawn' && randomAction.target === id;
    let showLookAround = randomAction?.type === 'look_around';

    // Interaction Overrides
    if (isSuccess) {
      bodyTransform = `scale(${scale * 1.1}) translateY(-20px) rotate(${tilt}deg)`;
      mouthType = 'laugh';
      isBlinking = true; // crescent eyes
      showCheer = true;
    } else if (isLoginError) {
      bodyTransform = `scale(${scale}) rotate(${tilt}deg) translateX(${Math.sin(Date.now() / 50) * 5}px)`; // Tremble
      mouthType = 'wavy';
      pupilX = 0; pupilY = 0; // XX eyes
    } else if (isAccountError) {
      mouthType = 'confused';
      showConfused = true;
    } else if (isButtonHovered) {
      pupilX = 0; pupilY = 15; // Look down at button
      mouthType = 'wow';
      showCheer = true;
    } else if (isPasswordHidden) {
      showHands = true;
      mouthType = 'nervous';
      pupilX = 0; pupilY = 0;
    } else if (isPasswordShown) {
      showHands = true; // Hands still up but peeking
      mouthType = 'smirk';
      pupilX = Math.sin(Date.now() / 100) * 10; // Darting eyes
      isBlinking = Math.random() > 0.5; // Fast blink
      bodyTransform = `scale(${scale}) translateY(10px) rotate(${tilt}deg)`; // Lean forward
    } else if (isUsernameFocused) {
      mouthType = 'smile';
      if (isTyping) {
        headTransform = `translateY(${Math.sin(Date.now() / 100) * 3}px)`; // Bounce
        if (typingLength % 4 === 0) {
          pupilX = id === 'blue' ? 15 : id === 'orange' ? -15 : 0; // Look at each other
        }
      }
    } else if (mousePos.dist < 200) {
      // Mouse close
      const leanAngle = Math.max(0, 15 - mousePos.dist / 15);
      headTransform = `rotate(${mousePos.x * leanAngle}deg)`;
      bodyTransform = `scale(${scale}) rotate(${tilt + mousePos.x * 5}deg) translateY(5px)`;
    } else if (showYawn) {
      mouthType = 'yawn';
      isBlinking = true;
      bodyTransform = `scale(${scale * 1.05}) scaleY(1.1) rotate(${tilt}deg)`;
    } else if (showLookAround && id === 'orange') {
      pupilX = Math.sin(Date.now() / 500) * 15;
      mouthType = 'nervous';
    }

    // Breathing animation (idle)
    if (isIdle && !isSuccess && !isError && !isButtonHovered) {
      const breath = Math.sin(Date.now() / 1000 + delay) * 3;
      bodyTransform += ` translateY(${breath}px)`;
    }

    // Smooth transitions
    const transitionStyle = {
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      transitionDelay: `${delay}ms`
    };

    const elasticTransition = {
      transition: 'all 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
      transitionDelay: `${delay}ms`
    };

    return (
      <div className={`absolute bottom-0 flex flex-col items-center justify-end ${id === 'blue' ? '-ml-24' : id === 'orange' ? 'ml-24' : 'z-20'}`} style={{ zIndex }}>
        <div style={{ transform: bodyTransform, ...elasticTransition, transformOrigin: 'bottom center' }}>
          <svg width="160" height="180" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="overflow-visible">
            <defs>
              <linearGradient id={`grad-${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={baseColor} />
                <stop offset="100%" stopColor={gradColor} />
              </linearGradient>
              <filter id={`glow-${id}`} x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="5" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* Body */}
            <g filter={`url(#glow-${id})`}>
              {type === 'round' && <path d="M40 180C40 90 50 40 100 40C150 40 160 90 160 180Z" fill={`url(#grad-${id})`} />}
              {type === 'tall' && <path d="M50 180C50 70 65 20 100 20C135 20 150 70 150 180Z" fill={`url(#grad-${id})`} />}
              {type === 'short' && <path d="M30 180C30 110 40 60 100 60C160 60 170 110 170 180Z" fill={`url(#grad-${id})`} />}
              
              {/* Highlights & Shadows */}
              <path d="M50 60C70 50 90 50 100 60C80 70 60 80 50 60Z" fill="white" opacity="0.15" />
              <path d="M150 160C130 170 110 170 100 160C120 150 140 140 150 160Z" fill="black" opacity="0.15" />
            </g>

            {/* Head Group */}
            <g style={{ transform: headTransform, ...transitionStyle, transformOrigin: '100px 80px' }}>
              
              {/* Accessories - Top */}
              {id === 'blue' && (
                <path d="M100 40 Q110 20 120 30" stroke="#1E3A8A" strokeWidth="4" fill="none" strokeLinecap="round" 
                      style={{ transform: isTyping ? `rotate(${Math.sin(Date.now()/50)*15}deg)` : 'none', transformOrigin: '100px 40px' }}/>
              )}
              {id === 'green' && (
                <g style={{ transform: showHands && isPasswordHidden ? 'translateY(15px)' : showHands && isPasswordShown ? 'translateY(-5px) rotate(-5deg)' : 'none', ...transitionStyle }}>
                  <path d="M60 20 L140 20 L120 0 L80 0 Z" fill="#064E3B" />
                  <rect x="50" y="20" width="100" height="5" fill="#064E3B" rx="2" />
                </g>
              )}
              {id === 'orange' && (
                <g style={{ transform: isTyping ? `rotate(${Math.sin(Date.now()/50)*15}deg)` : 'none', transformOrigin: '100px 60px' }}>
                  <line x1="100" y1="60" x2="100" y2="30" stroke="#B45309" strokeWidth="4" />
                  <circle cx="100" cy="30" r="6" fill={isLoginError ? "#EF4444" : isButtonHovered ? "#FCD34D" : "#D97706"} 
                          className={isLoginError || isButtonHovered ? "animate-pulse" : ""} />
                </g>
              )}

              {/* Eyes Base */}
              <g>
                {/* Glasses/Goggles Frame */}
                {id === 'blue' && (
                  <g stroke="#1E3A8A" strokeWidth="6" fill="none">
                    <circle cx="70" cy="90" r="22" />
                    <circle cx="130" cy="90" r="22" />
                    <line x1="92" y1="90" x2="108" y2="90" />
                  </g>
                )}
                {id === 'green' && (
                  <g stroke="#064E3B" strokeWidth="6" fill="none">
                    <rect x="50" y="70" width="40" height="35" rx="5" />
                    <rect x="110" y="70" width="40" height="35" rx="5" />
                    <line x1="90" y1="87" x2="110" y2="87" />
                  </g>
                )}
                {id === 'orange' && (
                  <g style={{ transform: showHands && isPasswordHidden ? 'translateY(20px)' : showHands && isPasswordShown ? 'translateY(-15px)' : 'none', ...transitionStyle }}>
                    <rect x="45" y="65" width="110" height="45" rx="20" fill="#B45309" opacity="0.8" />
                    <rect x="50" y="70" width="100" height="35" rx="15" fill="#FDE68A" opacity="0.5" />
                  </g>
                )}

                {/* Eye Whites */}
                <circle cx="70" cy="90" r="18" fill="white" />
                <circle cx="130" cy="90" r="18" fill="white" />

                {/* Pupils or Closed Eyes */}
                {isBlinking ? (
                  <g stroke="#333" strokeWidth="4" strokeLinecap="round" fill="none">
                    {isSuccess ? (
                      <>
                        <path d="M60 90 Q70 80 80 90" />
                        <path d="M120 90 Q130 80 140 90" />
                      </>
                    ) : (
                      <>
                        <line x1="60" y1="90" x2="80" y2="90" />
                        <line x1="120" y1="90" x2="140" y2="90" />
                      </>
                    )}
                  </g>
                ) : isLoginError ? (
                  <g stroke="#333" strokeWidth="4" strokeLinecap="round">
                    <path d="M62 82 L78 98 M62 98 L78 82" />
                    <path d="M122 82 L138 98 M122 98 L138 82" />
                  </g>
                ) : (
                  <g style={{ transform: `translate(${pupilX}px, ${pupilY}px)`, ...transitionStyle }}>
                    <circle cx="70" cy="90" r="8" fill="#111" />
                    <circle cx="130" cy="90" r="8" fill="#111" />
                    {/* Pupil Highlight */}
                    <circle cx="67" cy="87" r="2" fill="white" />
                    <circle cx="127" cy="87" r="2" fill="white" />
                  </g>
                )}
              </g>

              {/* Mouth */}
              <g stroke="#333" strokeWidth="4" strokeLinecap="round" fill="none">
                {mouthType === 'smile' && <path d="M85 125 Q100 140 115 125" />}
                {mouthType === 'nervous' && <path d="M85 130 Q100 125 115 130" />}
                {mouthType === 'smirk' && <path d="M85 125 Q100 135 115 120" />}
                {mouthType === 'wow' && <circle cx="100" cy="130" r="8" fill="#333" />}
                {mouthType === 'laugh' && <path d="M80 125 Q100 150 120 125 Z" fill="#EF4444" />}
                {mouthType === 'wavy' && <path d="M80 130 Q90 120 100 130 T120 130" />}
                {mouthType === 'confused' && <path d="M90 130 L110 125" />}
                {mouthType === 'yawn' && <ellipse cx="100" cy="130" rx="15" ry="20" fill="#333" />}
                {mouthType === 'O' && <circle cx="100" cy="130" r="6" fill="#333" />}
              </g>
            </g>

            {/* Hands / Arms */}
            {id === 'blue' && showHands && isPasswordHidden && (
              <g stroke={baseColor} strokeWidth="16" strokeLinecap="round" fill="none" style={elasticTransition}>
                <path d="M40 140 Q60 80 70 90" />
                <path d="M160 140 Q140 80 130 90" />
              </g>
            )}
            {id === 'blue' && showHands && isPasswordShown && (
              <g stroke={baseColor} strokeWidth="16" strokeLinecap="round" fill="none" style={elasticTransition}>
                <path d="M40 140 Q50 100 60 110" />
                <path d="M160 140 Q150 100 140 110" />
              </g>
            )}
            {id === 'blue' && showCheer && (
              <g stroke={baseColor} strokeWidth="16" strokeLinecap="round" fill="none" style={elasticTransition}>
                <path d="M40 120 Q20 80 40 50" />
                <path d="M160 120 Q180 80 160 50" />
              </g>
            )}
            {id === 'green' && showCheer && (
              <g stroke={baseColor} strokeWidth="12" strokeLinecap="round" fill="none" style={elasticTransition}>
                <path d="M50 130 Q30 100 50 80" />
                {/* Thumbs up detail */}
                <circle cx="50" cy="80" r="8" fill={baseColor} />
                <path d="M50 80 L50 70" strokeWidth="6" />
              </g>
            )}
            {id === 'orange' && showConfused && (
              <g style={elasticTransition}>
                <path d="M150 130 Q170 100 150 80" stroke={baseColor} strokeWidth="12" strokeLinecap="round" fill="none" />
                <circle cx="150" cy="80" r="15" stroke="#333" strokeWidth="4" fill="none" />
                <line x1="150" y1="95" x2="140" y2="110" stroke="#333" strokeWidth="4" strokeLinecap="round" />
              </g>
            )}

          </svg>
        </div>
      </div>
    );
  };

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[300px] md:min-h-[400px] flex items-end justify-center bg-indigo-50/50 dark:bg-slate-900/30 rounded-3xl overflow-hidden pb-4">
      
      {/* Success Particles */}
      {isSuccess && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {[...Array(20)].map((_, i) => (
            <div key={i} className="absolute w-2 h-2 bg-yellow-400 rounded-full animate-ping" 
                 style={{ 
                   left: `${Math.random() * 100}%`, 
                   top: `${Math.random() * 100}%`,
                   animationDelay: `${Math.random() * 1}s`,
                   animationDuration: `${1 + Math.random()}s`
                 }}></div>
          ))}
        </div>
      )}

      <div className="relative w-full max-w-[400px] h-[200px] flex justify-center items-end">
        {/* Shadow base */}
        <div className="absolute bottom-0 w-[80%] h-6 bg-black/10 blur-md rounded-[100%]"></div>

        {/* Characters */}
        <div className="hidden sm:block">
          <Character 
            id="blue" 
            type="round"
            baseColor="#4A90E2" 
            gradColor="#6FB3F2" 
            scale={0.9} 
            tilt={5} 
            zIndex={10} 
            delay={0} 
          />
        </div>
        
        <Character 
          id="green" 
          type="tall"
          baseColor="#7ED321" 
          gradColor="#A8E063" 
          scale={1} 
          tilt={0} 
          zIndex={20} 
          delay={50} 
        />
        
        <div className="hidden sm:block">
          <Character 
            id="orange" 
            type="short"
            baseColor="#F5A623" 
            gradColor="#FFB347" 
            scale={0.85} 
            tilt={-5} 
            zIndex={15} 
            delay={100} 
          />
        </div>
      </div>

      {/* Decorative background elements */}
      <div className="absolute top-10 left-10 w-32 h-32 bg-blue-400/20 rounded-full blur-2xl animate-pulse"></div>
      <div className="absolute bottom-10 right-10 w-40 h-40 bg-indigo-400/20 rounded-full blur-2xl animate-pulse" style={{ animationDelay: '1s' }}></div>
    </div>
  );
};

export default AnimatedCharacters;
