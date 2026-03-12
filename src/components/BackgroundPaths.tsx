import React from "react";
import { motion } from "motion/react";

function FloatingPaths({ position, isGenerating }: { position: number, isGenerating: boolean }) {
    const paths = Array.from({ length: 36 }, (_, i) => ({
        id: i,
        d: `M-${380 - i * 5 * position} -${189 + i * 6}C-${
            380 - i * 5 * position
        } -${189 + i * 6} -${312 - i * 5 * position} ${216 - i * 6} ${
            152 - i * 5 * position
        } ${343 - i * 6}C${616 - i * 5 * position} ${470 - i * 6} ${
            684 - i * 5 * position
        } ${875 - i * 6} ${684 - i * 5 * position} ${875 - i * 6}`,
        width: 0.5 + i * 0.03,
    }));

    return (
        <div className="absolute inset-0 pointer-events-none">
            <svg
                className="w-full h-full"
                viewBox="0 0 696 316"
                fill="none"
            >
                <defs>
                  <linearGradient id={`colorGradient-${position}`} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.8" /> {/* emerald-500 */}
                    <stop offset="33%" stopColor="#06b6d4" stopOpacity="0.8" /> {/* cyan-500 */}
                    <stop offset="66%" stopColor="#8b5cf6" stopOpacity="0.8" /> {/* violet-500 */}
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.8" /> {/* blue-500 */}
                  </linearGradient>
                </defs>
                <title>Background Paths</title>
                {paths.map((path) => (
                    <motion.path
                        key={path.id}
                        d={path.d}
                        stroke={`url(#colorGradient-${position})`}
                        strokeWidth={path.width}
                        strokeOpacity={0.1 + path.id * 0.03}
                        initial={{ pathLength: 0.3, opacity: 0.6 }}
                        animate={{
                            pathLength: 1,
                            opacity: isGenerating ? [0.4, 0.8, 0.4] : [0.2, 0.5, 0.2],
                            pathOffset: [0, 1, 0],
                        }}
                        transition={{
                            duration: isGenerating ? 10 + Math.random() * 5 : 20 + Math.random() * 10,
                            repeat: Number.POSITIVE_INFINITY,
                            ease: "linear",
                        }}
                    />
                ))}
            </svg>
        </div>
    );
}

export default function BackgroundPaths({ isGenerating = false }: { isGenerating?: boolean }) {
    return (
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
            <div className={`absolute inset-0 transition-opacity duration-1000 ${isGenerating ? 'opacity-40 dark:opacity-60' : 'opacity-20 dark:opacity-30'}`}>
                <FloatingPaths position={1} isGenerating={isGenerating} />
                <FloatingPaths position={-1} isGenerating={isGenerating} />
            </div>
        </div>
    );
}
