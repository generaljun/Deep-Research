import React, { useState, useEffect, useRef } from 'react';

interface PupilProps {
  size?: number;
  maxDistance?: number;
  pupilColor?: string;
  forceLookX?: number;
  forceLookY?: number;
}

const Pupil = ({ 
  size = 12, 
  maxDistance = 5,
  pupilColor = "black",
  forceLookX,
  forceLookY
}: PupilProps) => {
  const [mouseX, setMouseX] = useState<number>(0);
  const [mouseY, setMouseY] = useState<number>(0);
  const pupilRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMouseX(e.clientX);
      setMouseY(e.clientY);
    };

    window.addEventListener("mousemove", handleMouseMove);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  const calculatePupilPosition = () => {
    if (!pupilRef.current) return { x: 0, y: 0 };

    if (forceLookX !== undefined && forceLookY !== undefined) {
      return { x: forceLookX, y: forceLookY };
    }

    const pupil = pupilRef.current.getBoundingClientRect();
    const pupilCenterX = pupil.left + pupil.width / 2;
    const pupilCenterY = pupil.top + pupil.height / 2;

    const deltaX = mouseX - pupilCenterX;
    const deltaY = mouseY - pupilCenterY;
    const distance = Math.min(Math.sqrt(deltaX ** 2 + deltaY ** 2), maxDistance);

    const angle = Math.atan2(deltaY, deltaX);
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;

    return { x, y };
  };

  const pupilPosition = calculatePupilPosition();

  return (
    <div
      ref={pupilRef}
      className="rounded-full"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        backgroundColor: pupilColor,
        transform: `translate(${pupilPosition.x}px, ${pupilPosition.y}px)`,
        transition: 'transform 0.1s ease-out',
      }}
    />
  );
};

interface EyeBallProps {
  size?: number;
  pupilSize?: number;
  maxDistance?: number;
  eyeColor?: string;
  pupilColor?: string;
  isBlinking?: boolean;
  forceLookX?: number;
  forceLookY?: number;
}

const EyeBall = ({ 
  size = 48, 
  pupilSize = 16, 
  maxDistance = 10,
  eyeColor = "white",
  pupilColor = "black",
  isBlinking = false,
  forceLookX,
  forceLookY
}: EyeBallProps) => {
  const [mouseX, setMouseX] = useState<number>(0);
  const [mouseY, setMouseY] = useState<number>(0);
  const eyeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMouseX(e.clientX);
      setMouseY(e.clientY);
    };

    window.addEventListener("mousemove", handleMouseMove);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  const calculatePupilPosition = () => {
    if (!eyeRef.current) return { x: 0, y: 0 };

    if (forceLookX !== undefined && forceLookY !== undefined) {
      return { x: forceLookX, y: forceLookY };
    }

    const eye = eyeRef.current.getBoundingClientRect();
    const eyeCenterX = eye.left + eye.width / 2;
    const eyeCenterY = eye.top + eye.height / 2;

    const deltaX = mouseX - eyeCenterX;
    const deltaY = mouseY - eyeCenterY;
    const distance = Math.min(Math.sqrt(deltaX ** 2 + deltaY ** 2), maxDistance);

    const angle = Math.atan2(deltaY, deltaX);
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;

    return { x, y };
  };

  const pupilPosition = calculatePupilPosition();

  return (
    <div
      ref={eyeRef}
      className="rounded-full flex items-center justify-center transition-all duration-150"
      style={{
        width: `${size}px`,
        height: isBlinking ? '2px' : `${size}px`,
        backgroundColor: eyeColor,
        overflow: 'hidden',
      }}
    >
      {!isBlinking && (
        <div
          className="rounded-full"
          style={{
            width: `${pupilSize}px`,
            height: `${pupilSize}px`,
            backgroundColor: pupilColor,
            transform: `translate(${pupilPosition.x}px, ${pupilPosition.y}px)`,
            transition: 'transform 0.1s ease-out',
          }}
        />
      )}
    </div>
  );
};

interface AnimatedCharactersProps {
  isPasswordFocused?: boolean;
  isPasswordVisible?: boolean;
  typingLength?: number;
  scaleMultiplier?: number;
  offsetX?: number;
}

const AnimatedCharacters: React.FC<AnimatedCharactersProps> = ({
  isPasswordFocused = false,
  isPasswordVisible = false,
  typingLength = 0,
  scaleMultiplier = 1,
  offsetX = 0,
}) => {
  const [mouseX, setMouseX] = useState<number>(0);
  const [mouseY, setMouseY] = useState<number>(0);
  const [isPurpleBlinking, setIsPurpleBlinking] = useState(false);
  const [isBlackBlinking, setIsBlackBlinking] = useState(false);
  const [isLookingAtEachOther, setIsLookingAtEachOther] = useState(false);
  const [isPurplePeeking, setIsPurplePeeking] = useState(false);
  
  const purpleRef = useRef<HTMLDivElement>(null);
  const blackRef = useRef<HTMLDivElement>(null);
  const yellowRef = useRef<HTMLDivElement>(null);
  const orangeRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const isTyping = typingLength > 0 && !isPasswordFocused;
  const showPassword = isPasswordVisible;
  const hasPassword = isPasswordFocused || typingLength > 0;

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const width = entry.contentRect.width;
        // 450px is the base width of the characters. We use 480 to leave a small margin.
        const newScale = Math.min(1, width / 480) * scaleMultiplier;
        setScale(newScale);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [scaleMultiplier]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMouseX(e.clientX);
      setMouseY(e.clientY);
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  useEffect(() => {
    const getRandomBlinkInterval = () => Math.random() * 4000 + 3000;

    const scheduleBlink = () => {
      const blinkTimeout = setTimeout(() => {
        setIsPurpleBlinking(true);
        setTimeout(() => {
          setIsPurpleBlinking(false);
          scheduleBlink();
        }, 150);
      }, getRandomBlinkInterval());

      return blinkTimeout;
    };

    const timeout = scheduleBlink();
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const getRandomBlinkInterval = () => Math.random() * 4000 + 3000;

    const scheduleBlink = () => {
      const blinkTimeout = setTimeout(() => {
        setIsBlackBlinking(true);
        setTimeout(() => {
          setIsBlackBlinking(false);
          scheduleBlink();
        }, 150);
      }, getRandomBlinkInterval());

      return blinkTimeout;
    };

    const timeout = scheduleBlink();
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (isTyping) {
      setIsLookingAtEachOther(true);
      const timer = setTimeout(() => {
        setIsLookingAtEachOther(false);
      }, 800);
      return () => clearTimeout(timer);
    } else {
      setIsLookingAtEachOther(false);
    }
  }, [isTyping]);

  useEffect(() => {
    if (hasPassword && showPassword) {
      const schedulePeek = () => {
        const peekInterval = setTimeout(() => {
          setIsPurplePeeking(true);
          setTimeout(() => {
            setIsPurplePeeking(false);
          }, 800);
        }, Math.random() * 3000 + 2000);
        return peekInterval;
      };

      const firstPeek = schedulePeek();
      return () => clearTimeout(firstPeek);
    } else {
      setIsPurplePeeking(false);
    }
  }, [hasPassword, showPassword, isPurplePeeking]);

  const calculatePosition = (ref: React.RefObject<HTMLDivElement | null>) => {
    if (!ref.current) return { faceX: 0, faceY: 0, bodySkew: 0 };

    const rect = ref.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 3;

    const deltaX = mouseX - centerX;
    const deltaY = mouseY - centerY;

    const faceX = Math.max(-15, Math.min(15, deltaX / 20));
    const faceY = Math.max(-10, Math.min(10, deltaY / 30));

    const bodySkew = Math.max(-6, Math.min(6, -deltaX / 120));

    return { faceX, faceY, bodySkew };
  };

  const purplePos = calculatePosition(purpleRef);
  const blackPos = calculatePosition(blackRef);
  const yellowPos = calculatePosition(yellowRef);
  const orangePos = calculatePosition(orangeRef);

  return (
    <div 
      ref={containerRef}
      className="relative w-full h-full min-h-[400px] flex items-end justify-center bg-indigo-50/50 dark:bg-slate-900/30 rounded-3xl overflow-hidden pt-12"
    >
      {/* Glowing Title */}
      <div className="absolute top-12 left-0 w-full flex justify-center z-30 pointer-events-none select-none">
        <div className="relative flex flex-col items-center">
          {/* Animated Glow */}
          <div className="absolute -inset-4 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 rounded-full blur-2xl opacity-40 animate-[pulse_3s_ease-in-out_infinite]"></div>
          
          <h2 className="relative text-2xl sm:text-3xl font-black tracking-widest flex items-center gap-3">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400 drop-shadow-sm">
              深度搜索
            </span>
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-purple-500"></span>
            </span>
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-400 dark:to-purple-400 drop-shadow-sm">
              深度报告
            </span>
          </h2>
        </div>
      </div>

      {/* Cartoon Characters */}
      <div 
        className="relative origin-bottom transition-transform duration-300 ease-out" 
        style={{ 
          width: '450px', 
          height: '400px',
          transform: `translateX(${offsetX}px) scale(${scale})`
        }}
      >
        {/* Purple tall rectangle character - Back layer */}
        <div 
          ref={purpleRef}
          className="absolute bottom-0 transition-all duration-700 ease-in-out"
          style={{
            left: '70px',
            width: '180px',
            height: (isTyping || (hasPassword && !showPassword)) ? '440px' : '400px',
            backgroundColor: '#6C3FF5',
            borderRadius: '10px 10px 0 0',
            zIndex: 1,
            transform: (hasPassword && showPassword)
              ? `skewX(0deg)`
              : (isTyping || (hasPassword && !showPassword))
                ? `skewX(${(purplePos.bodySkew || 0) - 12}deg) translateX(40px)` 
                : `skewX(${purplePos.bodySkew || 0}deg)`,
            transformOrigin: 'bottom center',
          }}
        >
          {/* Eyes */}
          <div 
            className="absolute flex gap-8 transition-all duration-700 ease-in-out"
            style={{
              left: (hasPassword && showPassword) ? `${20}px` : isLookingAtEachOther ? `${55}px` : `${45 + purplePos.faceX}px`,
              top: (hasPassword && showPassword) ? `${35}px` : isLookingAtEachOther ? `${65}px` : `${40 + purplePos.faceY}px`,
            }}
          >
            <EyeBall 
              size={18} 
              pupilSize={7} 
              maxDistance={5} 
              eyeColor="white" 
              pupilColor="#2D2D2D" 
              isBlinking={isPurpleBlinking}
              forceLookX={(hasPassword && showPassword) ? (isPurplePeeking ? 4 : -4) : isLookingAtEachOther ? 3 : undefined}
              forceLookY={(hasPassword && showPassword) ? (isPurplePeeking ? 5 : -4) : isLookingAtEachOther ? 4 : undefined}
            />
            <EyeBall 
              size={18} 
              pupilSize={7} 
              maxDistance={5} 
              eyeColor="white" 
              pupilColor="#2D2D2D" 
              isBlinking={isPurpleBlinking}
              forceLookX={(hasPassword && showPassword) ? (isPurplePeeking ? 4 : -4) : isLookingAtEachOther ? 3 : undefined}
              forceLookY={(hasPassword && showPassword) ? (isPurplePeeking ? 5 : -4) : isLookingAtEachOther ? 4 : undefined}
            />
          </div>
        </div>

        {/* Black tall rectangle character - Middle layer */}
        <div 
          ref={blackRef}
          className="absolute bottom-0 transition-all duration-700 ease-in-out"
          style={{
            left: '240px',
            width: '120px',
            height: '310px',
            backgroundColor: '#2D2D2D',
            borderRadius: '8px 8px 0 0',
            zIndex: 2,
            transform: (hasPassword && showPassword)
              ? `skewX(0deg)`
              : isLookingAtEachOther
                ? `skewX(${(blackPos.bodySkew || 0) * 1.5 + 10}deg) translateX(20px)`
                : (isTyping || (hasPassword && !showPassword))
                  ? `skewX(${(blackPos.bodySkew || 0) * 1.5}deg)` 
                  : `skewX(${blackPos.bodySkew || 0}deg)`,
            transformOrigin: 'bottom center',
          }}
        >
          {/* Eyes */}
          <div 
            className="absolute flex gap-6 transition-all duration-700 ease-in-out"
            style={{
              left: (hasPassword && showPassword) ? `${10}px` : isLookingAtEachOther ? `${32}px` : `${26 + blackPos.faceX}px`,
              top: (hasPassword && showPassword) ? `${28}px` : isLookingAtEachOther ? `${12}px` : `${32 + blackPos.faceY}px`,
            }}
          >
            <EyeBall 
              size={16} 
              pupilSize={6} 
              maxDistance={4} 
              eyeColor="white" 
              pupilColor="#2D2D2D" 
              isBlinking={isBlackBlinking}
              forceLookX={(hasPassword && showPassword) ? -4 : isLookingAtEachOther ? 0 : undefined}
              forceLookY={(hasPassword && showPassword) ? -4 : isLookingAtEachOther ? -4 : undefined}
            />
            <EyeBall 
              size={16} 
              pupilSize={6} 
              maxDistance={4} 
              eyeColor="white" 
              pupilColor="#2D2D2D" 
              isBlinking={isBlackBlinking}
              forceLookX={(hasPassword && showPassword) ? -4 : isLookingAtEachOther ? 0 : undefined}
              forceLookY={(hasPassword && showPassword) ? -4 : isLookingAtEachOther ? -4 : undefined}
            />
          </div>
        </div>

        {/* Orange semi-circle character - Front left */}
        <div 
          ref={orangeRef}
          className="absolute bottom-0 transition-all duration-700 ease-in-out"
          style={{
            left: '0px',
            width: '240px',
            height: '200px',
            zIndex: 3,
            backgroundColor: '#FF9B6B',
            borderRadius: '120px 120px 0 0',
            transform: (hasPassword && showPassword) ? `skewX(0deg)` : `skewX(${orangePos.bodySkew || 0}deg)`,
            transformOrigin: 'bottom center',
          }}
        >
          {/* Eyes - just pupils, no white */}
          <div 
            className="absolute flex gap-8 transition-all duration-200 ease-out"
            style={{
              left: (hasPassword && showPassword) ? `${50}px` : `${82 + (orangePos.faceX || 0)}px`,
              top: (hasPassword && showPassword) ? `${85}px` : `${90 + (orangePos.faceY || 0)}px`,
            }}
          >
            <Pupil size={12} maxDistance={5} pupilColor="#2D2D2D" forceLookX={(hasPassword && showPassword) ? -5 : undefined} forceLookY={(hasPassword && showPassword) ? -4 : undefined} />
            <Pupil size={12} maxDistance={5} pupilColor="#2D2D2D" forceLookX={(hasPassword && showPassword) ? -5 : undefined} forceLookY={(hasPassword && showPassword) ? -4 : undefined} />
          </div>
        </div>

        {/* Yellow tall rectangle character - Front right */}
        <div 
          ref={yellowRef}
          className="absolute bottom-0 transition-all duration-700 ease-in-out"
          style={{
            left: '310px',
            width: '140px',
            height: '230px',
            backgroundColor: '#E8D754',
            borderRadius: '70px 70px 0 0',
            zIndex: 4,
            transform: (hasPassword && showPassword) ? `skewX(0deg)` : `skewX(${yellowPos.bodySkew || 0}deg)`,
            transformOrigin: 'bottom center',
          }}
        >
          {/* Eyes - just pupils, no white */}
          <div 
            className="absolute flex gap-6 transition-all duration-200 ease-out"
            style={{
              left: (hasPassword && showPassword) ? `${20}px` : `${52 + (yellowPos.faceX || 0)}px`,
              top: (hasPassword && showPassword) ? `${35}px` : `${40 + (yellowPos.faceY || 0)}px`,
            }}
          >
            <Pupil size={12} maxDistance={5} pupilColor="#2D2D2D" forceLookX={(hasPassword && showPassword) ? -5 : undefined} forceLookY={(hasPassword && showPassword) ? -4 : undefined} />
            <Pupil size={12} maxDistance={5} pupilColor="#2D2D2D" forceLookX={(hasPassword && showPassword) ? -5 : undefined} forceLookY={(hasPassword && showPassword) ? -4 : undefined} />
          </div>
          {/* Horizontal line for mouth */}
          <div 
            className="absolute w-20 h-[4px] bg-[#2D2D2D] rounded-full transition-all duration-200 ease-out"
            style={{
              left: (hasPassword && showPassword) ? `${10}px` : `${40 + (yellowPos.faceX || 0)}px`,
              top: (hasPassword && showPassword) ? `${88}px` : `${88 + (yellowPos.faceY || 0)}px`,
            }}
          />
        </div>
      </div>

      {/* Decorative background elements */}
      <div className="absolute top-10 left-10 w-24 h-24 bg-blue-400/20 rounded-full blur-2xl animate-pulse"></div>
      <div className="absolute bottom-10 right-10 w-32 h-32 bg-indigo-400/20 rounded-full blur-2xl animate-pulse" style={{ animationDelay: '1s' }}></div>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-purple-400/10 rounded-full blur-3xl"></div>
    </div>
  );
};

export default AnimatedCharacters;
