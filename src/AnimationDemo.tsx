import React, { useState, useEffect } from 'react';
import { X, Brain, Search, PenTool, FileText, Database, User, Globe, HardDrive, CheckCircle } from 'lucide-react';

export default function AnimationDemo({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [chapter, setChapter] = useState(1);
  const totalChapters = 3;

  useEffect(() => {
    const timer = setInterval(() => {
      setStep((prev) => {
        if (prev === 0) return 1; // User -> AI (Topic)
        if (prev === 1) return 2; // AI -> AI (Outline)
        if (prev === 2) return 3; // AI -> Web (Search)
        if (prev === 3) return 4; // Web -> AI (Think)
        if (prev === 4) return 5; // AI -> AI (Write)
        if (prev === 5) return 6; // AI -> Disk (Append)
        if (prev === 6) {
          if (chapter < totalChapters) {
            setChapter(c => c + 1);
            return 2; // Loop back to Search
          }
          return 7; // Done
        }
        if (prev === 7) {
          setTimeout(() => {
            setStep(0);
            setChapter(1);
          }, 4000);
          return 7;
        }
        return prev;
      });
    }, 1500);
    return () => clearInterval(timer);
  }, [chapter]);

  const getStatusText = () => {
    switch(step) {
      case 0: return "1. 接收用户课题...";
      case 1: return "2. 大模型规划多章节大纲...";
      case 2: return `3. 正在通过博查检索 第 ${chapter} 章 素材...`;
      case 3: return `4. 大模型深度思考 第 ${chapter} 章 内容...`;
      case 4: return `5. 大模型撰写 第 ${chapter} 章 正文...`;
      case 5: return `6. 流式追加写入本地文件 (防OOM)...`;
      case 6: return `7. 第 ${chapter} 章 完成，休眠防限流...`;
      case 7: return "8. 万字报告生成完毕！推送通知。";
      default: return "";
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/80  z-[200] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-[#0a0a0a] rounded-3xl p-8 max-w-4xl w-full border border-slate-200 dark:border-cyan-900/50 shadow-2xl relative overflow-hidden animate-in fade-in zoom-in-95 duration-300">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-cyan-400 z-10 transition-colors"><X className="w-6 h-6" /></button>
        
        <div className="text-center mb-8">
          <h2 className="text-2xl font-black text-slate-800 dark:text-cyan-50 mb-2">系统底层运行逻辑演示</h2>
          <p className="text-blue-500 dark:text-cyan-400 font-mono text-sm h-5 font-bold">{getStatusText()}</p>
        </div>

        {/* Animation Canvas */}
        <div className="relative h-[360px] bg-slate-50 dark:bg-[#030712] rounded-2xl border border-slate-100 dark:border-cyan-900/30 p-6 overflow-hidden shadow-inner">
          
          {/* Background Grid */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>

          {/* User Node */}
          <div className={`absolute left-[10%] top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center transition-all duration-500 z-10 ${step === 0 ? 'scale-110' : 'scale-100 opacity-70'}`}>
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-3 shadow-lg transition-colors duration-500 ${step === 0 ? 'bg-blue-500 text-white shadow-blue-500/50' : 'bg-white dark:bg-cyan-950 text-slate-500 dark:text-cyan-500 border border-slate-200 dark:border-cyan-800'}`}>
              <User className="w-8 h-8" />
            </div>
            <span className="text-xs font-bold text-slate-600 dark:text-cyan-200 bg-white/80 dark:bg-[#0a0a0a]/80 px-2 py-1 rounded-md ">用户输入</span>
          </div>

          {/* AI Core Node */}
          <div className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center transition-all duration-500 z-10 ${(step >= 1 && step <= 4) || step === 7 ? 'scale-125' : 'scale-100 opacity-90'}`}>
            <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-3 shadow-2xl relative transition-colors duration-500 ${step === 7 ? 'bg-emerald-500 text-white shadow-emerald-500/50' : 'bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-cyan-500/50'}`}>
              {step === 7 ? <CheckCircle className="w-12 h-12" /> : <Brain className={`w-12 h-12 ${step >= 1 && step <= 4 ? 'animate-pulse' : ''}`} />}
              
              {/* Pulse rings */}
              {(step >= 1 && step <= 4) && (
                <>
                  <div className="absolute inset-0 rounded-full border-2 border-cyan-400 animate-ping opacity-20"></div>
                  <div className="absolute -inset-4 rounded-full border border-blue-400 animate-ping opacity-10" style={{ animationDelay: '0.2s' }}></div>
                </>
              )}
            </div>
            <span className="text-sm font-black text-slate-800 dark:text-cyan-50 bg-white/80 dark:bg-[#0a0a0a]/80 px-3 py-1 rounded-lg ">AI 核心引擎</span>
            {step >= 2 && step <= 6 && (
              <span className="absolute -bottom-8 text-[10px] font-mono bg-blue-100 dark:bg-cyan-900/80 text-blue-600 dark:text-cyan-300 px-2 py-0.5 rounded-full whitespace-nowrap border border-blue-200 dark:border-cyan-700">
                处理中: 第 {chapter}/{totalChapters} 章
              </span>
            )}
          </div>

          {/* Web Search Node */}
          <div className={`absolute right-[10%] top-[20%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center transition-all duration-500 z-10 ${step === 2 || step === 3 ? 'scale-110' : 'scale-100 opacity-70'}`}>
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-3 shadow-lg transition-colors duration-500 ${step === 2 || step === 3 ? 'bg-purple-500 text-white shadow-purple-500/50' : 'bg-white dark:bg-cyan-950 text-slate-500 dark:text-cyan-500 border border-slate-200 dark:border-cyan-800'}`}>
              <Globe className={`w-8 h-8 ${step === 2 ? 'animate-spin' : ''}`} />
            </div>
            <span className="text-xs font-bold text-slate-600 dark:text-cyan-200 bg-white/80 dark:bg-[#0a0a0a]/80 px-2 py-1 rounded-md ">博查检索</span>
          </div>

          {/* File System Node */}
          <div className={`absolute right-[10%] bottom-[20%] -translate-x-1/2 translate-y-1/2 flex flex-col items-center transition-all duration-500 z-10 ${step === 5 || step === 6 ? 'scale-110' : 'scale-100 opacity-70'}`}>
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-3 shadow-lg transition-colors duration-500 ${step === 5 || step === 6 ? 'bg-emerald-500 text-white shadow-emerald-500/50' : 'bg-white dark:bg-cyan-950 text-slate-500 dark:text-cyan-500 border border-slate-200 dark:border-cyan-800'}`}>
              <HardDrive className="w-8 h-8" />
            </div>
            <span className="text-xs font-bold text-slate-600 dark:text-cyan-200 bg-white/80 dark:bg-[#0a0a0a]/80 px-2 py-1 rounded-md ">NAS 本地存储</span>
          </div>

          {/* SVG Connection Lines */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
            {/* User to AI */}
            <line x1="10%" y1="50%" x2="50%" y2="50%" stroke="currentColor" strokeWidth="2" strokeDasharray="6,6" className="text-slate-300 dark:text-cyan-900/50" />
            
            {/* AI to Web */}
            <line x1="50%" y1="50%" x2="90%" y2="20%" stroke="currentColor" strokeWidth="2" strokeDasharray="6,6" className="text-slate-300 dark:text-cyan-900/50" />
            
            {/* AI to File */}
            <line x1="50%" y1="50%" x2="90%" y2="80%" stroke="currentColor" strokeWidth="2" strokeDasharray="6,6" className="text-slate-300 dark:text-cyan-900/50" />
          </svg>

          {/* Animated Particles using CSS */}
          {step === 0 && (
            <div className="absolute w-3 h-3 bg-blue-500 rounded-full shadow-[0_0_12px_rgba(59,130,246,0.9)] z-20" style={{ animation: 'particle-user-to-ai 1.5s linear infinite' }}></div>
          )}
          {step === 2 && (
            <div className="absolute w-3 h-3 bg-purple-500 rounded-full shadow-[0_0_12px_rgba(168,85,247,0.9)] z-20" style={{ animation: 'particle-ai-to-web 1.5s linear infinite' }}></div>
          )}
          {step === 3 && (
            <div className="absolute w-3 h-3 bg-cyan-500 rounded-full shadow-[0_0_12px_rgba(6,182,212,0.9)] z-20" style={{ animation: 'particle-web-to-ai 1.5s linear infinite' }}></div>
          )}
          {step === 5 && (
            <div className="absolute w-3 h-3 bg-emerald-500 rounded-full shadow-[0_0_12px_rgba(16,185,129,0.9)] z-20" style={{ animation: 'particle-ai-to-file 1.5s linear infinite' }}></div>
          )}

        </div>

        {/* Legend / Info */}
        <div className="mt-8 grid grid-cols-4 gap-4 text-center">
          <div className="bg-slate-50 dark:bg-[#030712] p-4 rounded-2xl border border-slate-100 dark:border-cyan-900/30 transition-all hover:shadow-md group">
            <Brain className="w-6 h-6 mx-auto mb-2 text-blue-500 group-hover:scale-110 transition-transform" />
            <div className="text-sm font-bold text-slate-700 dark:text-cyan-100">大纲规划</div>
            <div className="text-xs text-slate-500 dark:text-cyan-500/70 mt-1">全局视角分解课题</div>
          </div>
          <div className="bg-slate-50 dark:bg-[#030712] p-4 rounded-2xl border border-slate-100 dark:border-cyan-900/30 transition-all hover:shadow-md group">
            <Search className="w-6 h-6 mx-auto mb-2 text-purple-500 group-hover:scale-110 transition-transform" />
            <div className="text-sm font-bold text-slate-700 dark:text-cyan-100">单章检索</div>
            <div className="text-xs text-slate-500 dark:text-cyan-500/70 mt-1">过滤噪音，精准获取</div>
          </div>
          <div className="bg-slate-50 dark:bg-[#030712] p-4 rounded-2xl border border-slate-100 dark:border-cyan-900/30 transition-all hover:shadow-md group">
            <PenTool className="w-6 h-6 mx-auto mb-2 text-cyan-500 group-hover:scale-110 transition-transform" />
            <div className="text-sm font-bold text-slate-700 dark:text-cyan-100">深度撰写</div>
            <div className="text-xs text-slate-500 dark:text-cyan-500/70 mt-1">结合素材生成长文</div>
          </div>
          <div className="bg-slate-50 dark:bg-[#030712] p-4 rounded-2xl border border-slate-100 dark:border-cyan-900/30 transition-all hover:shadow-md group">
            <Database className="w-6 h-6 mx-auto mb-2 text-emerald-500 group-hover:scale-110 transition-transform" />
            <div className="text-sm font-bold text-slate-700 dark:text-cyan-100">流式落盘</div>
            <div className="text-xs text-slate-500 dark:text-cyan-500/70 mt-1">防 OOM，安全存储</div>
          </div>
        </div>

      </div>
      <style>{`
        @keyframes particle-user-to-ai {
          0% { left: 10%; top: 50%; transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
          20% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          80% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { left: 50%; top: 50%; transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
        }
        @keyframes particle-ai-to-web {
          0% { left: 50%; top: 50%; transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
          20% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          80% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { left: 90%; top: 20%; transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
        }
        @keyframes particle-web-to-ai {
          0% { left: 90%; top: 20%; transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
          20% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          80% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { left: 50%; top: 50%; transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
        }
        @keyframes particle-ai-to-file {
          0% { left: 50%; top: 50%; transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
          20% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          80% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { left: 90%; top: 80%; transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
