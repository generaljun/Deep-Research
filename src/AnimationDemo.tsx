import React from 'react';
import { X, Play, Brain, Search, PenTool, FileText } from 'lucide-react';

export default function AnimationDemo({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-[#0a0a0a] rounded-3xl p-8 max-w-2xl w-full border border-slate-200 dark:border-cyan-900/50 shadow-2xl relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X /></button>
        <h2 className="text-2xl font-bold mb-8 text-slate-800 dark:text-cyan-50">深度报告生成逻辑演示</h2>
        
        <div className="flex justify-between items-center space-x-4">
          {[
            { icon: Brain, label: '规划大纲' },
            { icon: Search, label: '联网检索' },
            { icon: PenTool, label: '深度撰写' },
            { icon: FileText, label: '报告生成' }
          ].map((step, i) => (
            <div key={i} className="flex flex-col items-center flex-1">
              <div className="w-16 h-16 rounded-full bg-blue-100 dark:bg-cyan-900/30 flex items-center justify-center mb-3 animate-pulse">
                <step.icon className="w-8 h-8 text-blue-600 dark:text-cyan-400" />
              </div>
              <span className="text-xs font-medium text-slate-600 dark:text-cyan-200">{step.label}</span>
            </div>
          ))}
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-8 text-center">
          系统自动规划大纲，调用博查 API 进行多轮联网检索，最后由大模型进行深度撰写并生成 Markdown 报告。
        </p>
      </div>
    </div>
  );
}
