import React, { useState, useEffect, useRef } from 'react';
import { Send, Settings, FileText, Loader2, CheckCircle, AlertCircle, Database, Server, Key, MessageSquare, Play, Cpu, Network, Zap, Target, Layers, Download, Archive, Moon, Sun, Monitor, HelpCircle, Shield, CheckCircle2, RefreshCw, Info } from 'lucide-react';
import SetupWizard from './SetupWizard';
import AnimationDemo from './AnimationDemo';

type Message = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

type Outline = {
  report_title: string;
  chapters: {
    chapter_num: number;
    chapter_title: string;
    core_points: string;
  }[];
};

type LogEntry = {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
};

const CHAT_STAGES = [
  { id: 1, title: '初探意图', desc: '明确核心研究方向与预期篇幅', icon: Target },
  { id: 2, title: '边界界定', desc: '圈定研究范围、时间跨度与地域', icon: Layers },
  { id: 3, title: '核心标的', desc: '确认需要重点分析的企业或技术', icon: Cpu },
  { id: 4, title: '深度挖掘', desc: '补充特殊要求（如数据来源、特定模型）', icon: Network },
  { id: 5, title: '大纲定稿', desc: 'AI 总结并生成结构化 JSON 大纲', icon: Zap },
];

function MagneticCursor() {
  const cursorRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    let mouseX = 0;
    let mouseY = 0;
    let cursorX = 0;
    let cursorY = 0;
    
    const moveCursor = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${mouseX - 4}px, ${mouseY - 4}px, 0)`;
      }
    };
    
    const animate = () => {
      cursorX += (mouseX - cursorX) * 0.2;
      cursorY += (mouseY - cursorY) * 0.2;
      if (cursorRef.current) {
        cursorRef.current.style.transform = `translate3d(${cursorX - 16}px, ${cursorY - 16}px, 0)`;
      }
      requestAnimationFrame(animate);
    };
    
    window.addEventListener('mousemove', moveCursor);
    const animId = requestAnimationFrame(animate);
    
    return () => {
      window.removeEventListener('mousemove', moveCursor);
      cancelAnimationFrame(animId);
    };
  }, []);

  return (
    <>
      <div ref={dotRef} className="fixed top-0 left-0 w-2 h-2 bg-cyan-400 rounded-full pointer-events-none z-[100] mix-blend-screen shadow-[0_0_10px_#22d3ee]" />
      <div ref={cursorRef} className="fixed top-0 left-0 w-8 h-8 border border-blue-500 dark:border-cyan-500/50 rounded-full pointer-events-none z-[99] mix-blend-screen transition-transform duration-75 ease-out" />
    </>
  );
}

const AI_VENDORS = [
  { name: '阿里云百炼 (Qwen)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-max', 'qwen-plus', 'qwen-coder-plus'] },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini'] },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', models: ['deepseek-chat', 'deepseek-coder'] },
  { name: '自定义', baseUrl: '', models: [] }
];

const SEARCH_PROVIDERS = [
  { name: '博查 (Bocha)', url: 'https://api.bochaai.com/v1/web-search' },
  { name: '自定义', url: '' }
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'generator' | 'reports' | 'admin'>('generator');
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [user, setUser] = useState<any>(JSON.parse(localStorage.getItem('user') || 'null'));
  const [theme, setTheme] = useState<'light' | 'dark' | 'auto'>(() => {
    return (localStorage.getItem('theme') as 'light' | 'dark' | 'auto') || 'auto';
  });
  const [isInitialized, setIsInitialized] = useState<boolean | null>(null);
  const [taskStatus, setTaskStatus] = useState<{ running: any, queue: any[] } | null>(null);
  const [isDemoOpen, setIsDemoOpen] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState(AI_VENDORS[0].name);
  const [selectedSearch, setSelectedSearch] = useState(SEARCH_PROVIDERS[0].name);
  const [settings, setSettings] = useState<Record<string, string>>({
    aliyun_api_key: '',
    llm_base_url: '',
    model_planner: '',
    model_writer: '',
    bocha_api_key: '',
    tg_bot_token: '',
    tg_chat_id: '',
    feishu_webhook: '',
    http_proxy: ''
  });

  const handleChange = (key: string, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleVendorChange = (vendorName: string) => {
    setSelectedVendor(vendorName);
    const vendor = AI_VENDORS.find(v => v.name === vendorName);
    if (vendor && vendor.baseUrl) {
      handleChange('llm_base_url', vendor.baseUrl);
      if (vendor.models.length > 0) handleChange('model_planner', vendor.models[0]);
    }
  };

  const handleSearchChange = (searchName: string) => {
    setSelectedSearch(searchName);
  };

  useEffect(() => {
    fetch('/api/system/status')
      .then(res => res.json())
      .then(data => setIsInitialized(data.initialized))
      .catch(() => setIsInitialized(true)); // Fallback if error
  }, []);

  useEffect(() => {
    if (!token) return;
    const poll = async () => {
      try {
        const res = await fetch('/api/task/status', { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        setTaskStatus(data);
      } catch (e) {}
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [token]);

  useEffect(() => {
    localStorage.setItem('theme', theme);
    const root = window.document.documentElement;
    
    const applyTheme = () => {
      root.classList.remove('light', 'dark');
      if (theme === 'auto') {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.classList.add(isDark ? 'dark' : 'light');
      } else {
        root.classList.add(theme);
      }
    };

    applyTheme();

    if (theme === 'auto') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => applyTheme();
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [theme]);

  const handleLogin = (newToken: string, userData: any) => {
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(userData));
    setToken(newToken);
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    setActiveTab('generator');
  };

  if (isInitialized === false) {
    return <SetupWizard onComplete={() => setIsInitialized(true)} />;
  }

  if (isInitialized === null) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#030712]"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>;
  }

  if (!token) {
    return <LoginView onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] dark:bg-[#030712] text-slate-800 dark:text-cyan-50 font-sans selection:bg-blue-200 dark:selection:bg-cyan-500/30 relative overflow-hidden transition-colors duration-500">
      {/* Task Progress Bar */}
      {taskStatus && (taskStatus.running || taskStatus.queue.length > 0) && (
        <div className="fixed bottom-0 left-0 w-full bg-white/90 dark:bg-[#0a0a0a]/90 border-t border-slate-200 dark:border-cyan-900/50 p-4 z-[100] backdrop-blur-md">
          <div className="max-w-7xl mx-auto">
            <div className="flex justify-between text-xs mb-2 font-medium">
              <span className="text-slate-600 dark:text-cyan-300">
                {taskStatus.running ? `正在为 ${taskStatus.running.user} 制作报告: ${taskStatus.running.topic}` : '队列中...'}
              </span>
              <span className="text-blue-600 dark:text-cyan-400">{taskStatus.running ? `${taskStatus.running.progress}%` : '等待中'}</span>
            </div>
            <div className="w-full bg-slate-200 dark:bg-cyan-900/30 rounded-full h-2 overflow-hidden">
              <div className="bg-blue-600 dark:bg-cyan-500 h-full transition-all duration-500" style={{ width: `${taskStatus.running ? taskStatus.running.progress : 0}%` }}></div>
            </div>
            {taskStatus.queue.length > 0 && (
              <div className="text-[10px] text-slate-400 mt-1">排队中: {taskStatus.queue.length} 个任务</div>
            )}
          </div>
        </div>
      )}

      {/* Anime Style Background Elements */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-5%] w-[40%] h-[40%] bg-blue-200/40 dark:bg-blue-100/20 dark:bg-cyan-900/20 blur-[100px] rounded-full mix-blend-multiply dark:mix-blend-screen transition-colors duration-500"></div>
        <div className="absolute bottom-[-10%] right-[-5%] w-[40%] h-[40%] bg-pink-200/40 dark:bg-blue-900/20 blur-[100px] rounded-full mix-blend-multiply dark:mix-blend-screen transition-colors duration-500"></div>
        <div className="absolute top-[30%] right-[20%] w-[20%] h-[20%] bg-purple-200/30 dark:bg-emerald-900/10 blur-[80px] rounded-full mix-blend-multiply dark:mix-blend-screen transition-colors duration-500"></div>
        {/* Subtle Grid */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
      </div>

      {/* Hero Image Section */}
      <div className="relative w-full h-64 md:h-80 overflow-hidden rounded-b-[3rem] shadow-sm mb-8 z-10">
        <img 
          src="https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&q=80&w=2000" 
          alt="Anime Landscape" 
          className="absolute inset-0 w-full h-full object-cover object-center opacity-90 dark:opacity-70 transition-opacity duration-500"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-white/80 dark:from-[#030712]/90 via-white/20 dark:via-[#030712]/40 to-transparent backdrop-blur-[2px]"></div>
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
          <button 
            onClick={() => setIsDemoOpen(true)}
            className="absolute top-4 right-4 bg-white/20 hover:bg-white/40 backdrop-blur-md text-white text-xs font-bold px-4 py-2 rounded-full transition-all flex items-center gap-2"
          >
            <Play className="w-3 h-3" /> 动画演示
          </button>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight text-slate-800 dark:text-cyan-50 drop-shadow-md mb-2 transition-colors duration-500" style={{ fontFamily: "'M PLUS Rounded 1c', sans-serif" }}>
            江军的深度报告生成AI助手
          </h1>
          <p className="text-slate-600 dark:text-cyan-200/80 font-medium tracking-wide bg-white/50 dark:bg-[#0a0a0a]/50 backdrop-blur-md px-4 py-1 rounded-full text-sm shadow-sm transition-colors duration-500">
            ✨ 简约 · 智能 · 专属引擎
          </p>
        </div>
      </div>

      {isDemoOpen && <AnimationDemo onClose={() => setIsDemoOpen(false)} />}

      <div className="max-w-5xl mx-auto p-6 relative z-10 -mt-16">
        <header className="flex flex-col md:flex-row items-center justify-between py-4 mb-8 gap-4 bg-white/80 dark:bg-white/80 dark:bg-[#0a0a0a]/80 backdrop-blur-xl p-4 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-cyan-900/20 border border-white/50 dark:border-cyan-900/50 transition-colors duration-500">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-100 to-pink-100 dark:from-cyan-900 dark:to-blue-900 flex items-center justify-center shadow-inner dark:shadow-none dark:border dark:border-blue-200 dark:border-cyan-500/30 transition-colors duration-500">
              <Cpu className="text-blue-500 dark:text-cyan-400 w-6 h-6" />
            </div>
            <div className="hidden md:block">
              <h2 className="text-lg font-bold text-slate-800 dark:text-cyan-50 transition-colors duration-500">AI 助手控制台</h2>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-slate-50/80 dark:bg-[#030712]/80 p-1.5 rounded-2xl border border-slate-100 dark:border-cyan-900/30 shadow-inner dark:shadow-none transition-colors duration-500">
            <button
              onClick={() => setActiveTab('generator')}
              className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all duration-300 flex items-center gap-2 ${
                activeTab === 'generator' 
                  ? 'bg-white dark:bg-gradient-to-r dark:from-cyan-600 dark:to-blue-600 text-blue-600 dark:text-white shadow-sm border border-slate-100 dark:border-transparent' 
                  : 'text-slate-500 dark:text-blue-500 dark:text-slate-500 dark:text-cyan-400/60 hover:text-slate-700 dark:hover:text-slate-600 dark:text-cyan-300 hover:bg-slate-100/50 dark:hover:bg-blue-100/20 dark:bg-cyan-900/20'
              }`}
            >
              <Zap className="w-4 h-4" />
              研究生成器
            </button>
            <button
              onClick={() => setActiveTab('reports')}
              className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all duration-300 flex items-center gap-2 ${
                activeTab === 'reports' 
                  ? 'bg-white dark:bg-gradient-to-r dark:from-cyan-600 dark:to-blue-600 text-blue-600 dark:text-white shadow-sm border border-slate-100 dark:border-transparent' 
                  : 'text-slate-500 dark:text-blue-500 dark:text-slate-500 dark:text-cyan-400/60 hover:text-slate-700 dark:hover:text-slate-600 dark:text-cyan-300 hover:bg-slate-100/50 dark:hover:bg-blue-100/20 dark:bg-cyan-900/20'
              }`}
            >
              <Archive className="w-4 h-4" />
              报告库
            </button>
            {user?.role === 'admin' && (
              <button
                onClick={() => setActiveTab('admin')}
                className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all duration-300 flex items-center gap-2 ${
                  activeTab === 'admin' 
                    ? 'bg-white dark:bg-gradient-to-r dark:from-cyan-600 dark:to-blue-600 text-blue-600 dark:text-white shadow-sm border border-slate-100 dark:border-transparent' 
                    : 'text-slate-500 dark:text-blue-500 dark:text-slate-500 dark:text-cyan-400/60 hover:text-slate-700 dark:hover:text-slate-600 dark:text-cyan-300 hover:bg-slate-100/50 dark:hover:bg-blue-100/20 dark:bg-cyan-900/20'
                }`}
              >
                <Settings className="w-4 h-4" />
                中枢控制台
              </button>
            )}
            <div className="w-px h-6 bg-slate-200 dark:bg-blue-100/50 dark:bg-cyan-900/50 mx-1"></div>
            <div className="flex items-center bg-slate-100/50 dark:bg-[#0a0a0a]/50 rounded-xl p-1">
              <button
                onClick={() => setTheme('light')}
                className={`p-1.5 rounded-lg transition-all ${theme === 'light' ? 'bg-white dark:bg-blue-100/50 dark:bg-cyan-900/50 text-amber-500 shadow-sm' : 'text-slate-400 dark:text-blue-400 dark:text-slate-400 dark:text-cyan-500/50 hover:text-slate-600 dark:hover:text-slate-600 dark:text-cyan-300'}`}
                title="白天模式"
              >
                <Sun className="w-4 h-4" />
              </button>
              <button
                onClick={() => setTheme('dark')}
                className={`p-1.5 rounded-lg transition-all ${theme === 'dark' ? 'bg-white dark:bg-blue-100/50 dark:bg-cyan-900/50 text-blue-500 shadow-sm' : 'text-slate-400 dark:text-blue-400 dark:text-slate-400 dark:text-cyan-500/50 hover:text-slate-600 dark:hover:text-slate-600 dark:text-cyan-300'}`}
                title="夜间模式"
              >
                <Moon className="w-4 h-4" />
              </button>
              <button
                onClick={() => setTheme('auto')}
                className={`p-1.5 rounded-lg transition-all ${theme === 'auto' ? 'bg-white dark:bg-blue-100/50 dark:bg-cyan-900/50 text-emerald-500 dark:text-emerald-500 shadow-sm' : 'text-slate-400 dark:text-blue-400 dark:text-slate-400 dark:text-cyan-500/50 hover:text-slate-600 dark:hover:text-slate-600 dark:text-cyan-300'}`}
                title="自动切换"
              >
                <Monitor className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={handleLogout}
              className="px-5 py-2 rounded-xl text-sm font-semibold text-red-500 dark:text-red-500 dark:text-red-400/80 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all duration-300"
            >
              退出
            </button>
          </div>
        </header>

        {user?.mustChangePassword ? (
          <ChangePasswordView token={token} onPasswordChanged={() => {
            const updatedUser = { ...user, mustChangePassword: false };
            localStorage.setItem('user', JSON.stringify(updatedUser));
            setUser(updatedUser);
          }} />
        ) : (
          <>
            {activeTab === 'generator' && <GeneratorView token={token} user={user} />}
            {activeTab === 'reports' && <ReportsView token={token} />}
            {activeTab === 'admin' && user?.role === 'admin' && <AdminView token={token} settings={settings} handleChange={handleChange} setSettings={setSettings} />}
          </>
        )}
      </div>
    </div>
  );
}

function ReportsView({ token }: { token: string }) {
  const [reports, setReports] = useState<{filename: string, size: number, createdAt: string}[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/reports', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        setReports(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [token]);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
      <div className="bg-white/90 dark:bg-[#0a0a0a]/90 border border-slate-200 dark:border-cyan-900/50 rounded-3xl p-8 md:p-10 backdrop-blur-xl shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/5 rounded-full blur-3xl"></div>
        <h2 className="text-2xl font-bold mb-8 flex items-center gap-3 text-slate-800 dark:text-cyan-50">
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-cyan-950 border border-blue-200 dark:border-cyan-500/30 flex items-center justify-center">
            <Archive className="w-5 h-5 text-blue-500 dark:text-cyan-400" />
          </div>
          本地报告归档
        </h2>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-blue-400 dark:text-slate-500 dark:text-cyan-500/60">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : reports.length === 0 ? (
          <div className="text-center py-12 text-blue-400 dark:text-slate-500 dark:text-cyan-500/60 border border-dashed border-slate-200 dark:border-cyan-900/50 rounded-2xl">
            暂无生成的报告，请前往生成器创建。
          </div>
        ) : (
          <div className="grid gap-4 relative z-10">
            {reports.map(r => (
              <div key={r.filename} className="bg-slate-50 dark:bg-[#030712] border border-slate-100 dark:border-cyan-900/30 hover:border-blue-500 dark:border-cyan-500/50 transition-all p-5 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 group">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-blue-50/50 dark:bg-cyan-950/50 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-blue-500 dark:text-cyan-400" />
                  </div>
                  <div>
                    <h3 className="text-slate-700 dark:text-cyan-100 font-bold text-lg group-hover:text-slate-600 dark:text-cyan-300 transition-colors">{r.filename.replace('.md', '')}</h3>
                    <div className="text-xs text-blue-400 dark:text-slate-500 dark:text-cyan-500/60 mt-1 font-mono flex gap-3">
                      <span>{new Date(r.createdAt).toLocaleString()}</span>
                      <span>{(r.size / 1024).toFixed(2)} KB</span>
                    </div>
                  </div>
                </div>
                <a 
                  href={`/api/reports/${r.filename}?token=${token}`} 
                  download 
                  className="px-5 py-2.5 bg-blue-50/50 dark:bg-cyan-950/50 text-slate-600 dark:text-cyan-300 border border-slate-200 dark:border-cyan-800 rounded-xl text-sm font-bold hover:bg-blue-100 dark:bg-cyan-900 hover:border-blue-500 dark:hover:border-cyan-400 transition-all flex items-center gap-2 shrink-0"
                >
                  <Download className="w-4 h-4" />
                  下载 Markdown
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GeneratorView({ token, user }: { token: string, user: any }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [topic, setTopic] = useState('');
  const [length, setLength] = useState('5000-8000');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [outline, setOutline] = useState<Outline | null>(null);
  const [status, setStatus] = useState<'idle' | 'generating' | 'done'>('idle');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [systemStatus, setSystemStatus] = useState<{ isBusy: boolean, currentTask: any }>({ isBusy: false, currentTask: null });
  const [currentUser, setCurrentUser] = useState(user);
  
  // Track conversation turn (1 to 5)
  const conversationTurn = Math.min(5, Math.floor(messages.filter(m => m.role === 'user').length));

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setCurrentUser(data));
  }, [token, status]);

  useEffect(() => {
    const eventSource = new EventSource(`/api/system-status/stream?token=${token}`);
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'system_status') {
        setSystemStatus(data.data);
      }
    };

    return () => eventSource.close();
  }, [token]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    if (!taskId) return;

    const eventSource = new EventSource(`/api/research/${taskId}/stream?token=${token}`);
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setLogs(prev => [...prev, data]);
    };

    eventSource.addEventListener('done', () => {
      setStatus('done');
      eventSource.close();
    });

    eventSource.onerror = (error) => {
      console.error('SSE Error:', error);
    };

    return () => eventSource.close();
  }, [taskId, token]);

  const handleStartChat = () => {
    if (!topic.trim()) return;
    const initialMsg = `我想写一份关于【${topic}】的深度研究报告，字数预期在 ${length} 字。请作为专业的行业分析师，通过最多4轮简短的追问，帮我明确研究的边界、重点企业和特殊要求，最后在第5轮直接输出结构化大纲。`;
    setMessages([{ role: 'user', content: initialMsg }]);
    setStep(2);
    sendMessage(initialMsg);
  };

  const sendMessage = async (text: string) => {
    setLoading(true);
    const newMessages = [...messages, { role: 'user' as const, content: text }];
    if (text !== messages[0]?.content) {
      setMessages(newMessages);
    }
    setInput('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ messages: newMessages }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (error) {
      console.error(error);
      setMessages((prev) => [...prev, { role: 'assistant', content: '抱歉，网络请求失败，请检查后端配置。' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateOutline = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/generate-outline', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ topic, length }),
      });
      const data = await res.json();
      setOutline(data);
      setStep(3);
    } catch (error) {
      console.error(error);
      alert('生成大纲失败，请重试。');
    } finally {
      setLoading(false);
    }
  };

  const handleStartReport = async () => {
    if (systemStatus.isBusy) {
      alert(`系统繁忙，正在为用户 [${systemStatus.currentTask?.username}] 生成报告，请排队等待。`);
      return;
    }
    if (currentUser?.role !== 'admin' && currentUser?.quota <= 0) {
      alert('您的报告生成额度已用完，请联系管理员充值。');
      return;
    }

    setStatus('generating');
    setLogs([]);
    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ topic: outline?.report_title || topic, length }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setTaskId(data.taskId);
    } catch (error: any) {
      console.error(error);
      alert(`启动后台任务失败: ${error.message}`);
      setStatus('idle');
    }
  };

  return (
    <div className="space-y-8">
      {systemStatus.isBusy && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/50 rounded-xl p-4 flex items-center gap-3 text-amber-700 dark:text-amber-200 animate-pulse">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>系统繁忙：正在为用户 <strong>[{systemStatus.currentTask?.username}]</strong> 生成报告《{systemStatus.currentTask?.topic}》，请排队等待...</span>
        </div>
      )}
      {currentUser?.role !== 'admin' && (
        <div className="bg-blue-100/20 dark:bg-cyan-900/20 border border-blue-200 dark:border-cyan-500/30 rounded-xl p-4 flex items-center justify-between text-slate-700 dark:text-cyan-100">
          <span className="flex items-center gap-2"><Database className="w-4 h-4 text-blue-500 dark:text-cyan-400" /> 您的剩余生成额度</span>
          <span className="font-bold text-xl text-blue-500 dark:text-cyan-400">{currentUser?.quota}</span>
        </div>
      )}
      {step === 1 && (
        <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 rounded-3xl blur-xl group-hover:blur-2xl transition-all duration-500"></div>
            <div className="relative bg-white/80 dark:bg-[#0a0a0a]/80 border border-slate-200 dark:border-cyan-900/50 rounded-3xl p-8 md:p-10 backdrop-blur-xl shadow-2xl">
              <div className="flex items-center gap-4 mb-8 pb-6 border-b border-slate-100 dark:border-cyan-900/30">
                <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-cyan-950 border border-blue-200 dark:border-cyan-500/30 flex items-center justify-center shadow-sm dark:shadow-[0_0_15px_rgba(6,182,212,0.2)]">
                  <Target className="w-6 h-6 text-blue-500 dark:text-cyan-400" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-slate-800 dark:text-cyan-50">初始化研究矩阵</h2>
                  <p className="text-blue-500 dark:text-slate-500 dark:text-cyan-400/60 text-sm mt-1">设定核心参数以启动 AI 认知引擎</p>
                </div>
              </div>
              
              <div className="space-y-8">
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-cyan-300">
                    <Database className="w-4 h-4" />
                    核心研究课题 (Topic)
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      placeholder="例如：2026年氢动力无人机的最新进展"
                      className="w-full bg-slate-50 dark:bg-[#030712] border border-slate-200 dark:border-cyan-900/50 rounded-xl pl-4 pr-12 py-4 text-slate-800 dark:text-cyan-50 placeholder:text-blue-800 dark:text-cyan-800 focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:focus:ring-cyan-500/50 focus:border-blue-500 dark:border-cyan-500 transition-all shadow-inner"
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-500/40 animate-pulse"></span>
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-500/60 animate-pulse delay-75"></span>
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-500/80 animate-pulse delay-150"></span>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-cyan-300">
                    <Layers className="w-4 h-4" />
                    预期报告深度 (Depth & Length)
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[
                      { len: '3000-5000', label: '简报级', desc: '快速洞察，核心数据提取' },
                      { len: '5000-8000', label: '研报级', desc: '深度剖析，多维交叉验证' },
                      { len: '8000-12000', label: '白皮书级', desc: '全景扫描，底层逻辑推演' }
                    ].map(({ len, label, desc }) => (
                      <button
                        key={len}
                        onClick={() => setLength(len)}
                        className={`relative overflow-hidden p-5 rounded-2xl border text-left transition-all duration-300 ${
                          length === len
                            ? 'bg-blue-50/40 dark:bg-cyan-950/40 border-blue-500 dark:border-cyan-500 shadow-md dark:shadow-[0_0_20px_rgba(6,182,212,0.15)]'
                            : 'bg-slate-50 dark:bg-[#030712] border-slate-100 dark:border-cyan-900/30 hover:border-blue-300 dark:hover:border-cyan-700/50 hover:bg-blue-50/20 dark:bg-cyan-950/20'
                        }`}
                      >
                        {length === len && (
                          <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-cyan-500/20 to-transparent rounded-bl-full"></div>
                        )}
                        <div className={`font-bold text-lg mb-1 ${length === len ? 'text-slate-600 dark:text-cyan-300' : 'text-slate-700 dark:text-cyan-100'}`}>
                          {label}
                        </div>
                        <div className={`text-xs font-mono mb-3 ${length === len ? 'text-blue-500 dark:text-cyan-400' : 'text-blue-600 dark:text-cyan-600'}`}>
                          {len} 字
                        </div>
                        <div className="text-xs text-blue-500 dark:text-slate-400 dark:text-cyan-400/50 leading-relaxed">
                          {desc}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleStartChat}
                  disabled={!topic.trim() || systemStatus.isBusy || (currentUser?.role !== 'admin' && currentUser?.quota <= 0)}
                  className="w-full relative group overflow-hidden rounded-xl disabled:opacity-50 disabled:cursor-not-allowed mt-4"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-cyan-600 via-blue-600 to-cyan-600 bg-[length:200%_auto] animate-gradient group-hover:bg-[length:100%_auto] transition-all duration-500"></div>
                  <div className="relative px-4 py-4 flex items-center justify-center gap-3 text-white font-bold tracking-wide">
                    <Zap className="w-5 h-5" />
                    {systemStatus.isBusy ? '系统繁忙，请排队等待' : (currentUser?.role !== 'admin' && currentUser?.quota <= 0) ? '额度不足' : '建立神经连接，开始需求对齐'}
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
          <div className="flex flex-col h-[750px] bg-white/90 dark:bg-[#0a0a0a]/90 border border-slate-200 dark:border-cyan-900/50 rounded-3xl overflow-hidden backdrop-blur-xl shadow-2xl relative">
            
            {/* Top Progress Bar */}
            <div className="absolute top-0 left-0 w-full h-1 bg-blue-50 dark:bg-cyan-950">
              <div 
                className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-500 ease-out"
                style={{ width: `${(Math.max(1, conversationTurn) / 5) * 100}%` }}
              ></div>
            </div>

            <div className="p-6 border-b border-slate-100 dark:border-cyan-900/30 bg-slate-50/50 dark:bg-[#030712]/50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-800 dark:text-cyan-50 flex items-center gap-2">
                  <Network className="w-5 h-5 text-blue-500 dark:text-cyan-400" />
                  认知对齐矩阵 (Phase {Math.max(1, conversationTurn)}/5)
                </h2>
                <p className="text-xs text-blue-500 dark:text-slate-500 dark:text-cyan-400/60 mt-1">AI 正在通过多轮对话锚定研究边界</p>
              </div>
              <button
                onClick={handleGenerateOutline}
                disabled={loading}
                className="text-sm bg-blue-50/50 dark:bg-cyan-950/50 text-slate-600 dark:text-cyan-300 border border-blue-200 dark:border-cyan-500/30 px-4 py-2 rounded-xl hover:bg-blue-100/50 dark:bg-cyan-900/50 hover:border-blue-500 dark:hover:border-cyan-400 transition-all flex items-center gap-2 shadow-sm dark:shadow-[0_0_10px_rgba(6,182,212,0.1)]"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                {loading ? '正在编译大纲...' : '强制结束对话，生成大纲'}
              </button>
            </div>

            {/* Stage Visualization */}
            <div className="px-6 py-4 bg-blue-50/10 dark:bg-cyan-950/10 border-b border-slate-100 dark:border-cyan-900/20 overflow-x-auto">
              <div className="flex items-center justify-between min-w-[600px] gap-2">
                {CHAT_STAGES.map((stage, idx) => {
                  const isActive = Math.max(1, conversationTurn) === stage.id;
                  const isPast = Math.max(1, conversationTurn) > stage.id;
                  const Icon = stage.icon;
                  
                  return (
                    <div key={stage.id} className="flex-1 flex flex-col items-center relative group">
                      {/* Connecting Line */}
                      {idx < CHAT_STAGES.length - 1 && (
                        <div className={`absolute top-5 left-[50%] w-full h-[2px] ${isPast ? 'bg-cyan-500/50' : 'bg-blue-100/30 dark:bg-cyan-900/30'}`}></div>
                      )}
                      
                      <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-500 ${
                        isActive 
                          ? 'bg-blue-100 dark:bg-cyan-900 border-cyan-400 text-slate-600 dark:text-cyan-300 shadow-md dark:shadow-[0_0_15px_rgba(6,182,212,0.4)] scale-110' 
                          : isPast 
                            ? 'bg-blue-50 dark:bg-cyan-950 border-cyan-700 text-blue-600 dark:text-cyan-600' 
                            : 'bg-slate-50 dark:bg-[#030712] border-slate-200 dark:border-cyan-900/50 text-blue-800 dark:text-cyan-800'
                      }`}>
                        {isPast ? <CheckCircle className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                      </div>
                      
                      <div className="mt-3 text-center">
                        <div className={`text-xs font-bold ${isActive ? 'text-slate-600 dark:text-cyan-300' : isPast ? 'text-blue-600 dark:text-cyan-600' : 'text-blue-800 dark:text-cyan-800'}`}>
                          {stage.title}
                        </div>
                        <div className={`text-[10px] mt-1 max-w-[100px] mx-auto leading-tight ${isActive ? 'text-blue-500 dark:text-cyan-400/70' : 'text-transparent dark:text-transparent'}`}>
                          {stage.desc}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] bg-blend-overlay">
              {messages.map((msg, idx) => {
                // Skip the initial hidden prompt in UI if desired, but let's show it for context or format it nicely
                if (idx === 0 && msg.role === 'user') return null; 

                return (
                  <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-6 py-4 text-sm leading-relaxed shadow-lg ${
                      msg.role === 'user' 
                        ? 'bg-gradient-to-br from-cyan-800 to-blue-900 text-slate-800 dark:text-cyan-50 rounded-tr-sm border border-cyan-700/50' 
                        : 'bg-slate-50 dark:bg-[#030712]/80 border border-slate-200 dark:border-cyan-900/50 text-slate-700 dark:text-cyan-100 rounded-tl-sm backdrop-blur-md'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                );
              })}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-slate-50 dark:bg-[#030712]/80 border border-slate-200 dark:border-cyan-900/50 rounded-2xl rounded-tl-sm px-6 py-4 flex items-center gap-3 backdrop-blur-md">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 rounded-full bg-cyan-500 animate-bounce"></span>
                      <span className="w-2 h-2 rounded-full bg-cyan-500 animate-bounce delay-75"></span>
                      <span className="w-2 h-2 rounded-full bg-cyan-500 animate-bounce delay-150"></span>
                    </div>
                    <span className="text-sm text-blue-500 dark:text-cyan-400/70 font-mono">AI 正在解析意图...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-6 bg-slate-50 dark:bg-[#030712] border-t border-slate-100 dark:border-cyan-900/30">
              <div className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 rounded-xl blur opacity-50 group-focus-within:opacity-100 transition duration-500"></div>
                <div className="relative flex items-center bg-white dark:bg-[#0a0a0a] border border-slate-200 dark:border-cyan-800/50 rounded-xl overflow-hidden">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && input.trim() && sendMessage(input)}
                    placeholder={conversationTurn >= 5 ? "对话已完成，请点击右上角生成大纲" : "输入你的补充要求..."}
                    disabled={conversationTurn >= 5 || loading}
                    className="w-full bg-transparent pl-5 pr-12 py-4 text-sm text-slate-800 dark:text-cyan-50 placeholder:text-blue-800 dark:text-cyan-800 focus:outline-none disabled:opacity-50"
                  />
                  <button
                    onClick={() => input.trim() && sendMessage(input)}
                    disabled={!input.trim() || loading || conversationTurn >= 5}
                    className="absolute right-2 p-2.5 bg-blue-50 dark:bg-cyan-950 text-blue-500 dark:text-cyan-400 rounded-lg hover:bg-blue-100 dark:bg-cyan-900 hover:text-slate-600 dark:text-cyan-300 disabled:opacity-50 disabled:bg-transparent transition-all"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 3 && outline && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
          <div className="bg-white/90 dark:bg-[#0a0a0a]/90 border border-slate-200 dark:border-cyan-900/50 rounded-3xl p-8 md:p-10 backdrop-blur-xl shadow-2xl relative overflow-hidden">
            {/* Decorative background */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/5 rounded-full blur-3xl"></div>
            
            <h2 className="text-2xl font-bold mb-8 flex items-center gap-3 text-slate-800 dark:text-cyan-50">
              <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-cyan-950 border border-blue-200 dark:border-cyan-500/30 flex items-center justify-center">
                <Database className="w-5 h-5 text-blue-500 dark:text-cyan-400" />
              </div>
              研究大纲编译完成
            </h2>
            
            <div className="bg-slate-50 dark:bg-[#030712] border border-slate-200 dark:border-cyan-900/50 rounded-2xl p-8 mb-8 relative z-10 shadow-inner">
              <h3 className="text-xl font-black text-transparent dark:text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400 mb-8 pb-6 border-b border-slate-100 dark:border-cyan-900/30">
                {outline.report_title}
              </h3>
              <div className="space-y-8">
                {outline.chapters.map((ch) => (
                  <div key={ch.chapter_num} className="flex gap-5 group">
                    <div className="w-10 h-10 rounded-xl bg-blue-50/50 dark:bg-cyan-950/50 border border-slate-200 dark:border-cyan-800 flex items-center justify-center text-sm font-black text-blue-400 dark:text-cyan-500 shrink-0 group-hover:bg-blue-100 dark:bg-cyan-900 group-hover:border-blue-500 dark:border-cyan-500 transition-all shadow-[0_0_10px_rgba(6,182,212,0.05)]">
                      {String(ch.chapter_num).padStart(2, '0')}
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-700 dark:text-cyan-100 mb-2 text-lg group-hover:text-slate-600 dark:text-cyan-300 transition-colors">{ch.chapter_title}</h4>
                      <p className="text-sm text-blue-400 dark:text-slate-500 dark:text-cyan-500/70 leading-relaxed">{ch.core_points}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {status === 'idle' && (
              <button
                onClick={handleStartReport}
                className="w-full relative group overflow-hidden rounded-xl"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-emerald-600 via-cyan-600 to-emerald-600 bg-[length:200%_auto] animate-gradient group-hover:bg-[length:100%_auto] transition-all duration-500"></div>
                <div className="relative px-4 py-5 flex items-center justify-center gap-3 text-white font-bold tracking-wide text-lg">
                  <Play className="w-6 h-6 fill-current" />
                  确认大纲，启动后台静默生成引擎
                </div>
              </button>
            )}

            {status === 'done' && (
              <div className="bg-emerald-950/30 border border-emerald-200 dark:border-emerald-500/30 rounded-2xl p-8 text-center space-y-4 relative overflow-hidden">
                <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 mix-blend-overlay"></div>
                <div className="w-16 h-16 rounded-full bg-emerald-900/50 border border-emerald-500/50 flex items-center justify-center mx-auto mb-6 shadow-[0_0_30px_rgba(16,185,129,0.2)]">
                  <CheckCircle className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
                </div>
                <h3 className="text-xl font-bold text-emerald-600 dark:text-emerald-400">核心引擎已点火！</h3>
                <p className="text-sm text-emerald-200/60 max-w-md mx-auto leading-relaxed">
                  您可以安全地关闭此页面。NAS 后端正在为您进行深度检索和撰写，完成后将通过 Telegram 和飞书发送最终报告。
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {(status === 'generating' || status === 'done' || taskId) && (
        <div className="bg-white/90 dark:bg-[#0a0a0a]/90 border border-slate-200 dark:border-cyan-900/50 rounded-3xl overflow-hidden backdrop-blur-xl shadow-2xl animate-in fade-in slide-in-from-bottom-8 duration-700">
          <div className="p-5 border-b border-slate-100 dark:border-cyan-900/30 bg-slate-50 dark:bg-[#030712] flex justify-between items-center">
            <h2 className="font-bold flex items-center gap-3 text-sm text-slate-700 dark:text-cyan-100">
              <Server className="w-5 h-5 text-blue-400 dark:text-cyan-500" />
              系统执行终端 (Terminal)
            </h2>
            {status === 'generating' && (
              <span className="flex items-center gap-2 text-xs font-mono text-blue-500 dark:text-cyan-400 bg-blue-50/50 dark:bg-cyan-950/50 border border-slate-200 dark:border-cyan-800 px-3 py-1.5 rounded-lg">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
                PROCESSING
              </span>
            )}
            {status === 'done' && (
              <span className="flex items-center gap-2 text-xs font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-950/50 border border-emerald-800 px-3 py-1.5 rounded-lg">
                <CheckCircle className="w-3 h-3" />
                COMPLETED
              </span>
            )}
          </div>
          
          <div className="h-[400px] overflow-y-auto p-6 font-mono text-xs md:text-sm space-y-3 bg-slate-50 dark:bg-[#030712] relative">
            {/* Terminal scanline effect */}
            <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.25)_50%)] bg-[length:100%_4px] z-10"></div>
            
            {logs.length === 0 && status === 'generating' && (
              <div className="text-blue-600 dark:text-cyan-600 animate-pulse">Waiting for server logs...</div>
            )}
            
            {logs.map((log, idx) => (
              <div key={idx} className="flex gap-4 relative z-20">
                <span className="text-blue-700 dark:text-cyan-700 shrink-0 select-none">
                  [{new Date(log.timestamp).toLocaleTimeString()}]
                </span>
                <span className={`
                  ${log.type === 'error' ? 'text-red-500 dark:text-red-400 font-bold' : ''}
                  ${log.type === 'success' ? 'text-emerald-600 dark:text-emerald-400 font-bold' : ''}
                  ${log.type === 'warning' ? 'text-amber-500 dark:text-amber-400' : ''}
                  ${log.type === 'info' ? 'text-slate-600 dark:text-cyan-300' : ''}
                `}>
                  {log.message}
                </span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}

const TooltipLabel = ({ label, title, desc }: { label: string, title: string, desc: string }) => (
  <label className="flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-cyan-600 mb-1.5">
    {label}
    <div className="relative group">
      <HelpCircle className="w-3.5 h-3.5 text-slate-400 hover:text-blue-500 dark:hover:text-cyan-400 cursor-help transition-colors" />
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-slate-800 dark:bg-cyan-950 text-white dark:text-cyan-100 text-xs rounded-xl shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 pointer-events-none border border-slate-700 dark:border-cyan-800">
        <div className="font-bold mb-1.5 text-sm text-blue-300 dark:text-cyan-300">{title}</div>
        <p className="text-slate-300 dark:text-cyan-100/80 leading-relaxed">{desc}</p>
        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-slate-800 dark:bg-cyan-950 border-b border-r border-slate-700 dark:border-cyan-800 rotate-45"></div>
      </div>
    </div>
  </label>
);

function AdminView({ token, settings, handleChange, setSettings }: { token: string, settings: Record<string, string>, handleChange: (key: string, value: string) => void, setSettings: React.Dispatch<React.SetStateAction<Record<string, string>>> }) {
  const [activeAdminTab, setActiveAdminTab] = useState<'settings' | 'logs' | 'system'>('settings');
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [newQuota, setNewQuota] = useState(3);
  const [logs, setLogs] = useState<any[]>([]);
  const [versionInfo, setVersionInfo] = useState<{ currentVersion: string, remoteVersion: string, hasUpdate: boolean, repoUrl: string } | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [testStatus, setTestStatus] = useState<Record<string, { loading: boolean, result: string | null, error: string | null }>>({});
  const [resetStep, setResetStep] = useState(0); // 0: idle, 1: first confirm, 2: second confirm
  const [confirmState, setConfirmState] = useState<{ type: string, id?: string } | null>(null);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    fetch('/api/settings', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setSettings(prev => ({ ...prev, ...data })));
      
    fetchUsers();
    fetchLogs();
    checkUpdate();
  }, [token]);

  const checkUpdate = async () => {
    setCheckingUpdate(true);
    try {
      const res = await fetch('/api/system/check-update', { headers: { 'Authorization': `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok) setVersionInfo(data);
    } catch (e) {
      console.error('Check update failed:', e);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleUpdate = async () => {
    setUpdating(true);
    try {
      const res = await fetch('/api/system/update', { 
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` } 
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message, 'success');
      } else {
        showToast(data.error, 'error');
      }
    } catch (e) {
      showToast('更新请求失败', 'error');
    } finally {
      setUpdating(false);
      setConfirmState(null);
    }
  };

  const handleReset = async () => {
    if (resetStep < 2) {
      setResetStep(prev => prev + 1);
      return;
    }
    
    try {
      const res = await fetch('/api/system/reset', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      const data = await res.json();
      if (res.ok) {
        setResetStep(0);
        showToast('系统已重置，即将重新开始配置', 'success');
        setTimeout(() => window.location.reload(), 1500);
      } else {
        showToast(`重置失败: ${data.error}`, 'error');
        setResetStep(0);
      }
    } catch (e) {
      showToast('重置请求失败', 'error');
      setResetStep(0);
    }
  };

  const fetchUsers = () => {
    fetch('/api/users', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setUsers(data));
  };

  const fetchLogs = () => {
    fetch('/api/logs', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setLogs(data));
  };

  const handleClearLogs = async () => {
    try {
      const res = await fetch('/api/logs', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        fetchLogs();
        setConfirmState(null);
      }
    } catch (e) {
      alert('清除失败');
    }
  };

  const testConnection = async (type: 'llm' | 'search' | 'push') => {
    setTestStatus(prev => ({ ...prev, [type]: { loading: true, result: null, error: null } }));
    try {
      const res = await fetch(`/api/test/${type}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(settings)
      });
      const data = await res.json();
      if (res.ok) {
        setTestStatus(prev => ({ ...prev, [type]: { loading: false, result: data.message, error: null } }));
      } else {
        setTestStatus(prev => ({ ...prev, [type]: { loading: false, result: null, error: data.error } }));
      }
    } catch (e: any) {
      setTestStatus(prev => ({ ...prev, [type]: { loading: false, result: null, error: e.message } }));
    }
  };

  const TestResult = ({ type }: { type: string }) => {
    const status = testStatus[type];
    if (!status) return null;
    if (status.loading) return <span className="text-xs text-blue-500 animate-pulse flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> 测试中...</span>;
    if (status.result) return <span className="text-xs text-emerald-500 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> {status.result}</span>;
    if (status.error) return <span className="text-xs text-red-500 flex items-center gap-1" title={status.error}><AlertCircle className="w-3 h-3" /> 测试失败</span>;
    return null;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(settings)
      });
      showToast('配置已安全写入 SQLite 数据库！', 'success');
    } catch (e) {
      showToast('保存失败，请检查后端状态。', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAddUser = async () => {
    if (!newUsername || !newPassword) return showToast('请输入用户名和密码', 'info');
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ username: newUsername, password: newPassword, role: newRole, quota: newQuota })
      });
      if (res.ok) {
        setNewUsername('');
        setNewPassword('');
        setNewQuota(3);
        fetchUsers();
        showToast('用户创建成功', 'success');
      } else {
        const data = await res.json();
        showToast(data.error || '添加失败', 'error');
      }
    } catch (e) {
      showToast('请求失败', 'error');
    }
  };

  const handleDeleteUser = async (id: string) => {
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        fetchUsers();
        setConfirmState(null);
      } else {
        const data = await res.json();
        showToast(data.error || '删除失败', 'error');
      }
    } catch (e) {
      showToast('请求失败', 'error');
    }
  };

  const handleUpdateQuota = async (id: string, quota: number) => {
    try {
      const res = await fetch(`/api/users/${id}/quota`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ quota })
      });
      if (res.ok) fetchUsers();
      else showToast('更新额度失败', 'error');
    } catch (e) {
      showToast('请求失败', 'error');
    }
  };

const [selectedVendor, setSelectedVendor] = useState(AI_VENDORS[0].name);
const [selectedSearch, setSelectedSearch] = useState(SEARCH_PROVIDERS[0].name);

const handleVendorChange = (vendorName: string) => {
  setSelectedVendor(vendorName);
  const vendor = AI_VENDORS.find(v => v.name === vendorName);
  if (vendor && vendor.baseUrl) {
    handleChange('llm_base_url', vendor.baseUrl);
    if (vendor.models.length > 0) handleChange('model_planner', vendor.models[0]);
  }
};

const handleSearchChange = (searchName: string) => {
  setSelectedSearch(searchName);
  const provider = SEARCH_PROVIDERS.find(p => p.name === searchName);
  if (provider && provider.url) {
    // Note: Search URL is hardcoded in server.ts, this is just for UI
  }
};

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
      <div className="bg-white/90 dark:bg-[#0a0a0a]/90 border border-slate-200 dark:border-cyan-900/50 rounded-3xl p-8 md:p-10 backdrop-blur-xl shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl"></div>
        
        <div className="flex items-center justify-between mb-8 relative z-10">
          <h2 className="text-2xl font-bold flex items-center gap-3 text-slate-800 dark:text-cyan-50">
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-cyan-950 border border-blue-200 dark:border-cyan-500/30 flex items-center justify-center">
              <Settings className="w-5 h-5 text-blue-500 dark:text-cyan-400" />
            </div>
            系统参数配置中枢
          </h2>
          <div className="flex gap-2 bg-slate-50 dark:bg-[#030712] p-1 rounded-lg border border-slate-200 dark:border-cyan-900/50">
            <button 
              onClick={() => setActiveAdminTab('settings')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeAdminTab === 'settings' ? 'bg-blue-100/50 dark:bg-cyan-900/50 text-slate-600 dark:text-cyan-300' : 'text-blue-600 dark:text-cyan-600 hover:text-blue-500 dark:text-cyan-400'}`}
            >
              参数调谐
            </button>
            <button 
              onClick={() => setActiveAdminTab('logs')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeAdminTab === 'logs' ? 'bg-blue-100/50 dark:bg-cyan-900/50 text-slate-600 dark:text-cyan-300' : 'text-blue-600 dark:text-cyan-600 hover:text-blue-500 dark:text-cyan-400'}`}
            >
              运行日志
            </button>
            <button 
              onClick={() => setActiveAdminTab('system')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors relative ${activeAdminTab === 'system' ? 'bg-blue-100/50 dark:bg-cyan-900/50 text-slate-600 dark:text-cyan-300' : 'text-blue-600 dark:text-cyan-600 hover:text-blue-500 dark:text-cyan-400'}`}
            >
              系统状态
              {versionInfo?.hasUpdate && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white dark:border-[#0a0a0a]"></span>
              )}
            </button>
          </div>
        </div>
        
        {/* Toast Notification */}
        {toast && (
          <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4 duration-300 border ${
            toast.type === 'success' ? 'bg-emerald-500 text-white border-emerald-400' : 
            toast.type === 'error' ? 'bg-red-500 text-white border-red-400' : 
            'bg-blue-500 text-white border-blue-400'
          }`}>
            {toast.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : 
             toast.type === 'error' ? <AlertCircle className="w-5 h-5" /> : 
             <Info className="w-5 h-5" />}
            <span className="font-bold text-sm">{toast.message}</span>
          </div>
        )}

        {activeAdminTab === 'settings' ? (
        <div className="space-y-8 relative z-10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* AI Models */}
            <div className="space-y-5 p-6 border border-slate-100 dark:border-cyan-900/30 rounded-2xl bg-slate-50/50 dark:bg-[#030712]/50 shadow-inner">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-cyan-900/50 pb-3">
                <h3 className="text-sm font-bold text-slate-600 dark:text-cyan-300 flex items-center gap-2">
                  <Key className="w-4 h-4" /> 大模型配置 (OpenAI 兼容)
                </h3>
                <div className="flex items-center gap-3">
                  <TestResult type="llm" />
                  <button onClick={() => testConnection('llm')} disabled={testStatus.llm?.loading} className="text-xs bg-blue-100/30 dark:bg-cyan-900/30 hover:bg-blue-200/50 dark:bg-cyan-800/50 text-blue-500 dark:text-cyan-400 px-3 py-1 rounded border border-slate-200 dark:border-cyan-800/50 transition-colors disabled:opacity-50">测试连接</button>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 dark:text-cyan-400 mb-1.5">大模型厂商</label>
                  <select value={selectedVendor} onChange={e => handleVendorChange(e.target.value)} className="w-full bg-white dark:bg-[#0a0a0a] border border-slate-200 dark:border-cyan-900/50 rounded-xl px-4 py-2.5 text-sm text-slate-700 dark:text-cyan-100 outline-none">
                    {AI_VENDORS.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
                  </select>
                </div>
                <div>
                  <TooltipLabel label="API Key" title="API Key" desc="大模型 API 密钥" />
                  <input type="password" placeholder="sk-xxxxx" value={settings.aliyun_api_key} onChange={e => handleChange('aliyun_api_key', e.target.value)} className="w-full bg-white dark:bg-[#0a0a0a] border border-slate-200 dark:border-cyan-900/50 rounded-xl px-4 py-2.5 text-sm text-slate-700 dark:text-cyan-100 focus:ring-2 focus:ring-blue-500/50 dark:focus:ring-cyan-500/50 outline-none transition-all" />
                </div>
                <div>
                  <TooltipLabel 
                    label="Base URL" 
                    title="API 接口地址" 
                    desc="大模型服务的请求地址。阿里云百炼默认为 https://dashscope.aliyuncs.com/compatible-mode/v1。如果是 OpenAI 或其他中转站，请填写对应的地址。" 
                  />
                  <input type="text" placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" value={settings.llm_base_url} onChange={e => handleChange('llm_base_url', e.target.value)} className="w-full bg-white dark:bg-[#0a0a0a] border border-slate-200 dark:border-cyan-900/50 rounded-xl px-4 py-2.5 text-sm text-slate-700 dark:text-cyan-100 focus:ring-2 focus:ring-blue-500/50 dark:focus:ring-cyan-500/50 outline-none transition-all" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <TooltipLabel 
                    label="规划师模型 (Planner)" 
                    title="大纲生成模型" 
                    desc="负责理解用户意图、规划报告结构和生成大纲。建议使用推理能力强的模型，如 qwen-max 或 gpt-4o。" 
                  />
                  <input type="text" placeholder="qwen-max" value={settings.model_planner} onChange={e => handleChange('model_planner', e.target.value)} className="w-full bg-white dark:bg-[#0a0a0a] border border-slate-200 dark:border-cyan-900/50 rounded-xl px-4 py-2.5 text-sm text-slate-700 dark:text-cyan-100 focus:ring-2 focus:ring-blue-500/50 dark:focus:ring-cyan-500/50 outline-none transition-all" />
                </div>
                <div>
                  <TooltipLabel 
                    label="撰稿人模型 (Writer)" 
                    title="正文撰写模型" 
                    desc="负责根据大纲和检索结果撰写长文。建议使用长文本生成能力强、性价比高的模型，如 qwen-plus 或 gpt-4o-mini。" 
                  />
                  <input type="text" placeholder="qwen-plus" value={settings.model_writer} onChange={e => handleChange('model_writer', e.target.value)} className="w-full bg-white dark:bg-[#0a0a0a] border border-slate-200 dark:border-cyan-900/50 rounded-xl px-4 py-2.5 text-sm text-slate-700 dark:text-cyan-100 focus:ring-2 focus:ring-blue-500/50 dark:focus:ring-cyan-500/50 outline-none transition-all" />
                </div>
              </div>
            </div>

            {/* Search API */}
            <div className="space-y-5 p-6 border border-slate-100 dark:border-cyan-900/30 rounded-2xl bg-slate-50/50 dark:bg-[#030712]/50 shadow-inner">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-cyan-900/50 pb-3">
                <h3 className="text-sm font-bold text-slate-600 dark:text-cyan-300 flex items-center gap-2">
                  <Server className="w-4 h-4" /> 检索服务配置
                </h3>
                <div className="flex items-center gap-3">
                  <TestResult type="search" />
                  <button onClick={() => testConnection('search')} disabled={testStatus.search?.loading} className="text-xs bg-blue-100/30 dark:bg-cyan-900/30 hover:bg-blue-200/50 dark:bg-cyan-800/50 text-blue-500 dark:text-cyan-400 px-3 py-1 rounded border border-slate-200 dark:border-cyan-800/50 transition-colors disabled:opacity-50">测试连接</button>
                </div>
              </div>
              <div>
                <TooltipLabel 
                  label="检索服务提供商" 
                  title="检索服务配置" 
                  desc="选择联网检索服务提供商。" 
                />
                <select value={selectedSearch} onChange={e => handleSearchChange(e.target.value)} className="w-full bg-white dark:bg-[#0a0a0a] border border-slate-200 dark:border-cyan-900/50 rounded-xl px-4 py-2.5 text-sm text-slate-700 dark:text-cyan-100 outline-none mb-4">
                  {SEARCH_PROVIDERS.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>
                <TooltipLabel 
                  label="博查 API Key (Bocha Web Search)" 
                  title="博查 Web Search API" 
                  desc="用于联网检索最新资料。请前往博查开放平台 (bochaai.com) 注册并获取 API Key。" 
                />
                <input type="password" placeholder="sk-xxxxx" value={settings.bocha_api_key} onChange={e => handleChange('bocha_api_key', e.target.value)} className="w-full bg-white dark:bg-[#0a0a0a] border border-slate-200 dark:border-cyan-900/50 rounded-xl px-4 py-2.5 text-sm text-slate-700 dark:text-cyan-100 focus:ring-2 focus:ring-blue-500/50 dark:focus:ring-cyan-500/50 outline-none transition-all" />
              </div>
              <div>
                <TooltipLabel 
                  label="Telegram 网络代理 (SOCKS5/HTTP)" 
                  title="Telegram 代理配置" 
                  desc="用于解决国内 NAS 无法直连 Telegram 的问题。格式如：socks5h://192.168.10.2:1070 或 http://127.0.0.1:7890。仅对 Telegram 推送生效，不影响国内大模型和检索服务。" 
                />
                <input type="text" placeholder="socks5h://192.168.10.2:1070" value={settings.http_proxy || ''} onChange={e => handleChange('http_proxy', e.target.value)} className="w-full bg-white dark:bg-[#0a0a0a] border border-slate-200 dark:border-cyan-900/50 rounded-xl px-4 py-2.5 text-sm text-slate-700 dark:text-cyan-100 focus:ring-2 focus:ring-blue-500/50 dark:focus:ring-cyan-500/50 outline-none transition-all" />
              </div>
            </div>

            {/* Notifications */}
            <div className="space-y-5 p-6 border border-slate-100 dark:border-cyan-900/30 rounded-2xl bg-slate-50/50 dark:bg-[#030712]/50 shadow-inner md:col-span-2">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-cyan-900/50 pb-3">
                <h3 className="text-sm font-bold text-slate-600 dark:text-cyan-300 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" /> 消息推送配置 (可选)
                </h3>
                <div className="flex items-center gap-3">
                  <TestResult type="push" />
                  <button onClick={() => testConnection('push')} disabled={testStatus.push?.loading} className="text-xs bg-blue-100/30 dark:bg-cyan-900/30 hover:bg-blue-200/50 dark:bg-cyan-800/50 text-blue-500 dark:text-cyan-400 px-3 py-1 rounded border border-slate-200 dark:border-cyan-800/50 transition-colors disabled:opacity-50">测试连接</button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <TooltipLabel 
                    label="Telegram Bot Token" 
                    title="TG 机器人 Token" 
                    desc="向 @BotFather 申请的机器人 Token，格式如 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11" 
                  />
                  <input type="password" placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz" value={settings.tg_bot_token} onChange={e => handleChange('tg_bot_token', e.target.value)} className="w-full bg-white dark:bg-[#0a0a0a] border border-slate-200 dark:border-cyan-900/50 rounded-xl px-4 py-2.5 text-sm text-slate-700 dark:text-cyan-100 focus:ring-2 focus:ring-blue-500/50 dark:focus:ring-cyan-500/50 outline-none transition-all" />
                </div>
                <div>
                  <TooltipLabel 
                    label="Telegram Chat ID" 
                    title="TG 接收者 ID" 
                    desc="接收通知的用户或群组 ID。可以通过向 @userinfobot 发送消息获取，通常为一串数字或带负号的数字。" 
                  />
                  <input type="text" placeholder="-1001234567890" value={settings.tg_chat_id} onChange={e => handleChange('tg_chat_id', e.target.value)} className="w-full bg-white dark:bg-[#0a0a0a] border border-slate-200 dark:border-cyan-900/50 rounded-xl px-4 py-2.5 text-sm text-slate-700 dark:text-cyan-100 focus:ring-2 focus:ring-blue-500/50 dark:focus:ring-cyan-500/50 outline-none transition-all" />
                </div>
                <div className="md:col-span-2">
                  <TooltipLabel 
                    label="Feishu Webhook URL" 
                    title="飞书群机器人 Webhook" 
                    desc="在飞书群设置中添加自定义机器人获取的 Webhook 地址。格式如 https://open.feishu.cn/open-apis/bot/v2/hook/..." 
                  />
                  <input type="text" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." value={settings.feishu_webhook} onChange={e => handleChange('feishu_webhook', e.target.value)} className="w-full bg-white dark:bg-[#0a0a0a] border border-slate-200 dark:border-cyan-900/50 rounded-xl px-4 py-2.5 text-sm text-slate-700 dark:text-cyan-100 focus:ring-2 focus:ring-blue-500/50 dark:focus:ring-cyan-500/50 outline-none transition-all" />
                </div>
              </div>
            </div>
            
            {/* User Management */}
            <div className="space-y-5 p-6 border border-slate-100 dark:border-cyan-900/30 rounded-2xl bg-slate-50/50 dark:bg-[#030712]/50 shadow-inner md:col-span-2">
              <h3 className="text-sm font-bold text-slate-600 dark:text-cyan-300 flex items-center gap-2 border-b border-slate-200 dark:border-cyan-900/50 pb-3">
                <Key className="w-4 h-4" /> 用户与权限管理
              </h3>
              
              <div className="bg-white dark:bg-[#0a0a0a] border border-slate-200 dark:border-cyan-900/50 rounded-xl p-4 mb-4">
                <h4 className="text-xs font-bold text-blue-400 dark:text-cyan-500 mb-3">添加新用户</h4>
                <div className="flex flex-col md:flex-row gap-3">
                  <input type="text" placeholder="用户名" value={newUsername} onChange={e => setNewUsername(e.target.value)} className="flex-1 bg-slate-50 dark:bg-[#030712] border border-slate-200 dark:border-cyan-900/50 rounded-lg px-3 py-2 text-sm text-slate-700 dark:text-cyan-100 focus:ring-1 focus:ring-blue-500 dark:focus:ring-cyan-500 outline-none" />
                  <input type="password" placeholder="初始密码" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="flex-1 bg-slate-50 dark:bg-[#030712] border border-slate-200 dark:border-cyan-900/50 rounded-lg px-3 py-2 text-sm text-slate-700 dark:text-cyan-100 focus:ring-1 focus:ring-blue-500 dark:focus:ring-cyan-500 outline-none" />
                  <select value={newRole} onChange={e => setNewRole(e.target.value)} className="bg-slate-50 dark:bg-[#030712] border border-slate-200 dark:border-cyan-900/50 rounded-lg px-3 py-2 text-sm text-slate-700 dark:text-cyan-100 focus:ring-1 focus:ring-blue-500 dark:focus:ring-cyan-500 outline-none">
                    <option value="user">普通用户</option>
                    <option value="admin">管理员</option>
                  </select>
                  <input type="number" placeholder="生成额度" value={newQuota} onChange={e => setNewQuota(parseInt(e.target.value))} className="w-24 bg-slate-50 dark:bg-[#030712] border border-slate-200 dark:border-cyan-900/50 rounded-lg px-3 py-2 text-sm text-slate-700 dark:text-cyan-100 focus:ring-1 focus:ring-blue-500 dark:focus:ring-cyan-500 outline-none" min="0" />
                  <button onClick={handleAddUser} className="bg-blue-100/50 dark:bg-cyan-900/50 text-slate-600 dark:text-cyan-300 border border-cyan-700 px-4 py-2 rounded-lg text-sm hover:bg-cyan-800 transition-colors">添加</button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left text-slate-700 dark:text-cyan-100">
                  <thead className="text-xs text-blue-400 dark:text-cyan-500 uppercase bg-blue-50 dark:bg-cyan-950/30 border-b border-slate-200 dark:border-cyan-900/50">
                    <tr>
                      <th className="px-4 py-3">用户名</th>
                      <th className="px-4 py-3">角色</th>
                      <th className="px-4 py-3">剩余额度</th>
                      <th className="px-4 py-3">创建时间</th>
                      <th className="px-4 py-3 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id} className="border-b border-slate-100 dark:border-cyan-900/30 hover:bg-blue-50/20 dark:bg-cyan-950/20">
                        <td className="px-4 py-3 font-medium">{u.username}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded text-xs ${u.role === 'admin' ? 'bg-emerald-900/50 text-emerald-600 dark:text-emerald-400' : 'bg-blue-900/50 text-blue-400'}`}>
                            {u.role}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {u.role === 'admin' ? (
                            <span className="text-blue-400 dark:text-slate-400 dark:text-cyan-500/50 text-xs">无限</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <input 
                                type="number" 
                                defaultValue={u.quota} 
                                onBlur={(e) => {
                                  const val = parseInt(e.target.value);
                                  if (!isNaN(val) && val !== u.quota) handleUpdateQuota(u.id, val);
                                }}
                                className="w-16 bg-slate-50 dark:bg-[#030712] border border-slate-200 dark:border-cyan-900/50 rounded px-2 py-1 text-xs text-slate-700 dark:text-cyan-100 focus:ring-1 focus:ring-blue-500 dark:focus:ring-cyan-500 outline-none"
                                min="0"
                              />
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-blue-400 dark:text-slate-500 dark:text-cyan-500/70">{new Date(u.created_at).toLocaleString()}</td>
                        <td className="px-4 py-3 text-right">
                          {confirmState?.type === 'deleteUser' && confirmState.id === u.id ? (
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => handleDeleteUser(u.id)} className="text-red-500 font-bold text-xs">确定</button>
                              <span className="text-slate-400">/</span>
                              <button onClick={() => setConfirmState(null)} className="text-slate-400 text-xs">取消</button>
                            </div>
                          ) : (
                            <button onClick={() => setConfirmState({ type: 'deleteUser', id: u.id })} className="text-red-500 dark:text-red-400 hover:text-red-300 text-xs">删除</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full relative group overflow-hidden rounded-xl mt-4"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-cyan-600 via-blue-600 to-cyan-600 bg-[length:200%_auto] animate-gradient group-hover:bg-[length:100%_auto] transition-all duration-500"></div>
            <div className="relative px-4 py-4 flex items-center justify-center gap-2 text-white font-bold tracking-wide">
              {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Database className="w-5 h-5" />}
              {saving ? '正在加密写入...' : '保存配置到本地 SQLite'}
            </div>
          </button>
        </div>
        ) : activeAdminTab === 'logs' ? (
          <div className="space-y-6 relative z-10">
            <div className="flex justify-between items-center bg-slate-50/50 dark:bg-[#030712]/50 p-4 rounded-xl border border-slate-100 dark:border-cyan-900/30">
              <div className="text-sm text-slate-600 dark:text-cyan-300">
                本地日志文件 (最多保留10个)
              </div>
              {confirmState?.type === 'clearLogs' ? (
                <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 p-1 rounded-lg border border-red-200 dark:border-red-800">
                  <span className="text-xs font-bold text-red-800 dark:text-red-400 px-2">确认清空？</span>
                  <button onClick={handleClearLogs} className="px-3 py-1 bg-red-600 text-white rounded-md text-xs">确定</button>
                  <button onClick={() => setConfirmState(null)} className="px-3 py-1 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-md text-xs">取消</button>
                </div>
              ) : (
                <button onClick={() => setConfirmState({ type: 'clearLogs' })} className="bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-800/50 text-red-500 dark:text-red-400 px-4 py-2 rounded-lg text-sm border border-red-300 dark:border-red-800/50 transition-colors">
                  清除所有日志
                </button>
              )}
            </div>
            
            <div className="grid grid-cols-1 gap-4">
              {logs.length === 0 ? (
                <div className="text-center py-12 text-blue-400 dark:text-slate-400 dark:text-cyan-500/50 text-sm border border-dashed border-slate-100 dark:border-cyan-900/30 rounded-xl">
                  暂无日志文件
                </div>
              ) : (
                logs.map((log, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-white dark:bg-[#0a0a0a] border border-slate-100 dark:border-cyan-900/30 p-4 rounded-xl hover:border-blue-200 dark:border-cyan-500/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <FileText className="w-5 h-5 text-blue-400 dark:text-cyan-500" />
                      <div>
                        <div className="text-sm text-slate-700 dark:text-cyan-100 font-medium">{log.filename}</div>
                        <div className="text-xs text-blue-400 dark:text-slate-500 dark:text-cyan-500/60 mt-1">
                          {new Date(log.createdAt).toLocaleString()} · {(log.size / 1024).toFixed(2)} KB
                        </div>
                      </div>
                    </div>
                    <a 
                      href={`/api/logs/${log.filename}?token=${token}`} 
                      download
                      className="flex items-center gap-2 bg-blue-100/30 dark:bg-cyan-900/30 hover:bg-blue-200/50 dark:bg-cyan-800/50 text-slate-600 dark:text-cyan-300 px-3 py-1.5 rounded-lg text-xs border border-slate-200 dark:border-cyan-800/50 transition-colors"
                    >
                      <Download className="w-3 h-3" /> 下载
                    </a>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-8 relative z-10">
            <div className="bg-white dark:bg-[#0a0a0a] border border-slate-200 dark:border-cyan-900/50 rounded-2xl p-6">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-cyan-100 mb-6 flex items-center gap-2">
                <Shield className="w-5 h-5 text-blue-500 dark:text-cyan-400" />
                系统版本与更新
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-cyan-950/20 border border-slate-100 dark:border-cyan-900/30">
                  <div className="text-sm text-slate-500 dark:text-cyan-500 mb-1">当前版本</div>
                  <div className="text-2xl font-bold text-slate-800 dark:text-cyan-100 font-mono">
                    v{versionInfo?.currentVersion || '加载中...'}
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-cyan-950/20 border border-slate-100 dark:border-cyan-900/30">
                  <div className="text-sm text-slate-500 dark:text-cyan-500 mb-1">远程最新版本</div>
                  <div className="text-2xl font-bold text-slate-800 dark:text-cyan-100 font-mono">
                    v{versionInfo?.remoteVersion || '加载中...'}
                  </div>
                </div>
              </div>

              {versionInfo?.hasUpdate ? (
                <div className="p-6 rounded-xl bg-blue-50 dark:bg-cyan-900/20 border border-blue-100 dark:border-cyan-800/30">
                  <div className="flex items-start gap-4">
                    <div className="p-2 bg-blue-100 dark:bg-cyan-800/50 rounded-lg">
                      <Download className="w-5 h-5 text-blue-600 dark:text-cyan-400" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-blue-900 dark:text-cyan-100 mb-1">发现新版本！</h4>
                      <p className="text-sm text-blue-700 dark:text-cyan-300 mb-4">
                        检测到 GitHub 仓库有更新。您可以尝试点击下方按钮同步代码。
                      </p>
              <div className="flex flex-wrap gap-3">
                        {confirmState?.type === 'update' ? (
                          <div className="flex items-center gap-2 bg-blue-100 dark:bg-cyan-900/50 p-1 rounded-lg border border-blue-200 dark:border-cyan-800">
                            <span className="text-xs font-bold text-blue-800 dark:text-cyan-200 px-2">确认更新？</span>
                            <button onClick={handleUpdate} className="px-3 py-1 bg-blue-600 text-white rounded-md text-xs">确定</button>
                            <button onClick={() => setConfirmState(null)} className="px-3 py-1 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-md text-xs">取消</button>
                          </div>
                        ) : (
                          <button 
                            onClick={() => setConfirmState({ type: 'update' })}
                            disabled={updating}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-cyan-600 dark:hover:bg-cyan-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
                          >
                            {updating ? '正在同步...' : '同步最新代码'}
                          </button>
                        )}
                        <a 
                          href={versionInfo.repoUrl} 
                          target="_blank" 
                          rel="noreferrer"
                          className="px-4 py-2 bg-white dark:bg-transparent border border-blue-200 dark:border-cyan-800 text-blue-600 dark:text-cyan-400 rounded-lg text-sm font-medium hover:bg-blue-50 dark:hover:bg-cyan-900/30 transition-colors"
                        >
                          查看更新日志
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-900/20 rounded-full flex items-center justify-center mb-4">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 dark:text-emerald-400" />
                  </div>
                  <h4 className="text-lg font-medium text-slate-800 dark:text-cyan-100 mb-1">您的系统已是最新版本</h4>
                  <p className="text-sm text-slate-500 dark:text-cyan-500 mb-6">当前运行版本：v{versionInfo?.currentVersion}</p>
                  <button 
                    onClick={checkUpdate}
                    disabled={checkingUpdate}
                    className="px-4 py-2 bg-slate-100 dark:bg-cyan-900/30 hover:bg-slate-200 dark:hover:bg-cyan-800/50 text-slate-600 dark:text-cyan-300 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                  >
                    <RefreshCw className={`w-4 h-4 ${checkingUpdate ? 'animate-spin' : ''}`} />
                    {checkingUpdate ? '正在检查...' : '立即检查更新'}
                  </button>
                </div>
              )}
            </div>

            <div className="bg-white dark:bg-[#0a0a0a] border border-slate-200 dark:border-cyan-900/50 rounded-2xl p-6">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-cyan-100 mb-4 flex items-center gap-2">
                <Info className="w-5 h-5 text-slate-400 dark:text-cyan-600" />
                更新说明
              </h3>
              <ul className="space-y-3 text-sm text-slate-600 dark:text-cyan-400">
                <li className="flex gap-2">
                  <span className="text-blue-500 dark:text-cyan-500">•</span>
                  <span>由于您使用的是 Docker 部署，Web 端的“同步代码”仅能拉取最新的源码文件。</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-blue-500 dark:text-cyan-500">•</span>
                  <span>如果更新涉及依赖变更（package.json）或 Dockerfile 变更，您必须在 NAS 终端手动执行：</span>
                </li>
                <div className="bg-slate-900 text-slate-300 p-3 rounded-lg font-mono text-xs my-2">
                  git pull && docker compose up -d --build
                </div>
                <li className="flex gap-2">
                  <span className="text-blue-500 dark:text-cyan-500">•</span>
                  <span>建议在每次大版本更新后都执行上述命令以确保系统稳定性。</span>
                </li>
              </ul>
            </div>

            <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/50 rounded-2xl p-6">
              <h3 className="text-lg font-semibold text-red-800 dark:text-red-400 mb-4 flex items-center gap-2">
                <AlertCircle className="w-5 h-5" />
                危险区域 (Danger Zone)
              </h3>
              <p className="text-sm text-red-700 dark:text-red-300/70 mb-6">
                重置系统将永久删除所有 API 密钥、数据库配置和用户账号。执行后您需要重新走一遍初始化向导。
              </p>
              
              <div className="flex flex-col gap-4">
                {resetStep > 0 && (
                  <div className="bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800 p-5 rounded-2xl mb-2 animate-in zoom-in-95 duration-300">
                    <div className="flex items-start gap-3 mb-3">
                      <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-black text-red-900 dark:text-red-100">
                          {resetStep === 1 ? '您确定要执行重置吗？' : '这是最后一次警告！'}
                        </p>
                        <p className="text-xs text-red-700 dark:text-red-300/70 mt-1">
                          此操作将永久删除：所有 API 密钥、所有用户账号、所有系统设置。
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button 
                        onClick={handleReset}
                        className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-all shadow-md"
                      >
                        {resetStep === 1 ? '是的，我确定' : '立即重置 (点此执行)'}
                      </button>
                      <button 
                        onClick={() => setResetStep(0)}
                        className="flex-1 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold transition-all"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
                
                {resetStep === 0 && (
                  <button 
                    onClick={() => setResetStep(1)}
                    className="px-6 py-4 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-red-500/20 flex items-center justify-center gap-2 group"
                  >
                    <RefreshCw className="w-4 h-4 group-hover:rotate-180 transition-transform duration-500" />
                    重置系统并重新配置
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LoginView({ onLogin }: { onLogin: (token: string, user: any) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      
      const data = await res.json();
      if (res.ok) {
        onLogin(data.token, data.user);
      } else {
        setError(data.error || '登录失败');
      }
    } catch (err) {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-5%] w-[40%] h-[40%] bg-blue-200/40 blur-[100px] rounded-full mix-blend-multiply pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-5%] w-[40%] h-[40%] bg-pink-200/40 blur-[100px] rounded-full mix-blend-multiply pointer-events-none"></div>
      
      <div className="w-full max-w-md bg-white/80 border border-white/50 rounded-[2rem] p-8 backdrop-blur-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative z-10 animate-in fade-in slide-in-from-bottom-8 duration-700">
        <div className="flex justify-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-100 to-pink-100 flex items-center justify-center shadow-inner">
            <Key className="w-8 h-8 text-blue-500" />
          </div>
        </div>
        
        <h2 className="text-2xl font-bold text-center text-slate-800 mb-2">系统访问授权</h2>
        <p className="text-center text-slate-500 text-sm mb-8">请输入您的凭证以访问深度研究引擎</p>
        
        {error && (
          <div className="bg-red-50 border border-red-100 text-red-500 px-4 py-3 rounded-xl mb-6 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">用户名</label>
            <input 
              type="text" 
              value={username} 
              onChange={e => setUsername(e.target.value)} 
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 focus:ring-2 focus:ring-blue-500/50 outline-none transition-all"
              placeholder="admin"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">密码</label>
            <input 
              type="password" 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 focus:ring-2 focus:ring-blue-500/50 outline-none transition-all"
              placeholder="••••••••"
              required
            />
          </div>
          
          <button 
            type="submit" 
            disabled={loading}
            className="w-full relative group overflow-hidden rounded-xl mt-6"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-blue-500 via-pink-500 to-blue-500 bg-[length:200%_auto] animate-gradient group-hover:bg-[length:100%_auto] transition-all duration-500"></div>
            <div className="relative px-4 py-3.5 flex items-center justify-center gap-2 text-white font-bold tracking-wide">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : '登 录'}
            </div>
          </button>
        </form>
      </div>
    </div>
  );
}

function ChangePasswordView({ token, onPasswordChanged }: { token: string, onPasswordChanged: () => void }) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (newPassword !== confirmPassword) {
      return setError('两次输入的新密码不一致');
    }
    if (newPassword.length < 6) {
      return setError('新密码长度不能少于6位');
    }
    
    setLoading(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ oldPassword, newPassword })
      });
      
      if (res.ok) {
        onPasswordChanged();
      } else {
        const data = await res.json();
        setError(data.error || '修改失败');
      }
    } catch (err) {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-20 animate-in fade-in slide-in-from-bottom-8 duration-700">
      <div className="bg-white/80 border border-white/50 rounded-[2rem] p-8 backdrop-blur-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-amber-100 rounded-full blur-2xl"></div>
        
        <h2 className="text-2xl font-bold text-slate-800 mb-2 flex items-center gap-2">
          <AlertCircle className="w-6 h-6 text-amber-500" />
          首次登录安全设置
        </h2>
        <p className="text-slate-500 text-sm mb-8">为了您的系统安全，请修改默认的管理员密码。</p>
        
        {error && (
          <div className="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/50 text-red-500 dark:text-red-400 px-4 py-3 rounded-xl mb-6 text-sm">
            {error}
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="space-y-5 relative z-10">
          <div>
            <label className="block text-xs font-medium text-blue-600 dark:text-cyan-600 mb-1.5">当前密码 (默认: admin)</label>
            <input 
              type="password" 
              value={oldPassword} 
              onChange={e => setOldPassword(e.target.value)} 
              className="w-full bg-slate-50 dark:bg-[#030712] border border-slate-200 dark:border-cyan-900/50 rounded-xl px-4 py-3 text-sm text-slate-700 dark:text-cyan-100 focus:ring-2 focus:ring-blue-500/50 dark:focus:ring-cyan-500/50 outline-none transition-all"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-blue-600 dark:text-cyan-600 mb-1.5">新密码</label>
            <input 
              type="password" 
              value={newPassword} 
              onChange={e => setNewPassword(e.target.value)} 
              className="w-full bg-slate-50 dark:bg-[#030712] border border-slate-200 dark:border-cyan-900/50 rounded-xl px-4 py-3 text-sm text-slate-700 dark:text-cyan-100 focus:ring-2 focus:ring-blue-500/50 dark:focus:ring-cyan-500/50 outline-none transition-all"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-blue-600 dark:text-cyan-600 mb-1.5">确认新密码</label>
            <input 
              type="password" 
              value={confirmPassword} 
              onChange={e => setConfirmPassword(e.target.value)} 
              className="w-full bg-slate-50 dark:bg-[#030712] border border-slate-200 dark:border-cyan-900/50 rounded-xl px-4 py-3 text-sm text-slate-700 dark:text-cyan-100 focus:ring-2 focus:ring-blue-500/50 dark:focus:ring-cyan-500/50 outline-none transition-all"
              required
            />
          </div>
          
          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-bold py-3.5 rounded-xl transition-all mt-6 flex justify-center items-center"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : '更新密码并进入系统'}
          </button>
        </form>
      </div>
    </div>
  );
}
