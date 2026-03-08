import React, { useState, useEffect } from 'react';
import { Loader2, CheckCircle2, AlertCircle, ArrowRight, Server, MessageSquare, Key, ShieldCheck, HelpCircle } from 'lucide-react';

const TooltipLabel = ({ label, title, desc }: { label: string, title: string, desc: string }) => (
  <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-cyan-100 mb-2">
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

export default function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [settings, setSettings] = useState({
    adminPassword: '',
    aliyun_api_key: '',
    llm_base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model_planner: 'qwen-max',
    model_writer: 'qwen-plus',
    bocha_api_key: '',
    tg_bot_token: '',
    tg_chat_id: '',
    feishu_app_id: '',
    feishu_app_secret: '',
    http_proxy: ''
  });

  const [testStatus, setTestStatus] = useState({
    llm: 'idle', // idle, loading, success, error
    search: 'idle',
    push: 'idle'
  });
  const [diagnostics, setDiagnostics] = useState<string[]>([]);

  const handleChange = (key: string, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const testConnection = async (type: 'llm' | 'search' | 'push') => {
    setTestStatus(prev => ({ ...prev, [type]: 'loading' }));
    setError('');
    setDiagnostics([]);
    try {
      const res = await fetch(`/api/test/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      const data = await res.json();
      if (res.ok) {
        setTestStatus(prev => ({ ...prev, [type]: 'success' }));
        if (data.diagnostics) setDiagnostics(data.diagnostics);
      } else {
        setTestStatus(prev => ({ ...prev, [type]: 'error' }));
        setError(data.error || '测试失败');
        if (data.diagnostics) setDiagnostics(data.diagnostics);
      }
    } catch (err: any) {
      setTestStatus(prev => ({ ...prev, [type]: 'error' }));
      setError('网络错误，请检查后端服务是否正常');
    }
  };

  const handleNext = () => {
    if (step === 1 && settings.adminPassword.length < 6) {
      return setError('管理员密码不能少于6位');
    }
    if (step === 2 && testStatus.llm !== 'success') {
      return setError('请先测试大模型连接并确保成功');
    }
    if (step === 3 && testStatus.search !== 'success') {
      return setError('请先测试检索服务并确保成功');
    }
    setError('');
    setStep(s => s + 1);
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/system/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      if (res.ok) {
        onComplete();
      } else {
        const data = await res.json();
        setError(data.error || '初始化失败');
      }
    } catch (err) {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#030712] flex items-center justify-center p-4 font-sans">
      <div className="max-w-2xl w-full bg-white dark:bg-[#0a0a0a] rounded-3xl shadow-xl border border-slate-200 dark:border-cyan-900/30 overflow-hidden">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-cyan-600 p-8 text-white text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
          <h1 className="text-3xl font-black mb-2 relative z-10">系统初始化向导</h1>
          <p className="text-blue-100 relative z-10">只需 4 步，完成 Deep Research Web 私有化部署</p>
          
          {/* Progress Bar */}
          <div className="flex justify-between items-center mt-8 relative z-10 max-w-md mx-auto">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm transition-colors ${step >= i ? 'bg-white text-blue-600' : 'bg-blue-500/50 text-blue-200'}`}>
                  {step > i ? <CheckCircle2 className="w-5 h-5" /> : i}
                </div>
              </div>
            ))}
            <div className="absolute top-4 left-0 w-full h-0.5 bg-blue-500/50 -z-10">
              <div className="h-full bg-white transition-all duration-300" style={{ width: `${((step - 1) / 3) * 100}%` }}></div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-8">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl mb-6">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span className="text-sm font-bold">{error}</span>
              </div>
              {diagnostics.length > 0 && (
                <div className="mt-2 p-3 bg-red-100/50 dark:bg-red-900/40 rounded-lg text-xs font-mono space-y-1">
                  <p className="opacity-70 mb-1 border-b border-red-200 dark:border-red-800 pb-1">诊断信息 (Diagnostics):</p>
                  {diagnostics.map((d, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="opacity-40">[{i+1}]</span>
                      <span>{d}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
              <div className="text-center mb-8">
                <ShieldCheck className="w-12 h-12 text-blue-500 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-slate-800 dark:text-cyan-50">第一步：账号安全</h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm mt-2">为了保障您的 NAS 安全，请设置管理员 (admin) 的初始密码。</p>
              </div>
              <div>
                <TooltipLabel 
                  label="管理员密码" 
                  title="管理员初始密码" 
                  desc="用于登录后台管理系统，至少 6 位字符。" 
                />
                <input 
                  type="password" 
                  value={settings.adminPassword} 
                  onChange={e => handleChange('adminPassword', e.target.value)} 
                  placeholder="至少 6 位字符"
                  className="w-full bg-slate-50 dark:bg-[#030712] border border-slate-200 dark:border-cyan-900/50 rounded-xl px-4 py-3 text-slate-700 dark:text-cyan-100 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
              <div className="text-center mb-8">
                <Server className="w-12 h-12 text-blue-500 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-slate-800 dark:text-cyan-50">第二步：大模型引擎</h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm mt-2">配置用于思考和撰写的核心大模型 API。</p>
              </div>
              <div className="space-y-4">
                <div>
                  <TooltipLabel 
                    label="API Key (如阿里云百炼)" 
                    title="大模型 API 密钥" 
                    desc="用于调用大模型接口的凭证。" 
                  />
                  <input type="password" value={settings.aliyun_api_key} onChange={e => handleChange('aliyun_api_key', e.target.value)} placeholder="sk-..." className="w-full bg-slate-50 dark:bg-[#030712] border border-slate-200 dark:border-cyan-900/50 rounded-xl px-4 py-3 text-slate-700 dark:text-cyan-100 focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <TooltipLabel 
                    label="Base URL" 
                    title="API 接口地址" 
                    desc="大模型服务的请求地址。阿里云百炼默认为 https://dashscope.aliyuncs.com/compatible-mode/v1。" 
                  />
                  <input type="text" value={settings.llm_base_url} onChange={e => handleChange('llm_base_url', e.target.value)} className="w-full bg-slate-50 dark:bg-[#030712] border border-slate-200 dark:border-cyan-900/50 rounded-xl px-4 py-3 text-slate-700 dark:text-cyan-100 focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <TooltipLabel 
                      label="规划师模型" 
                      title="大纲生成模型" 
                      desc="负责理解用户意图、规划报告结构和生成大纲。建议使用推理能力强的模型，如 qwen-max。" 
                    />
                    <input type="text" value={settings.model_planner} onChange={e => handleChange('model_planner', e.target.value)} className="w-full bg-slate-50 dark:bg-[#030712] border border-slate-200 dark:border-cyan-900/50 rounded-xl px-4 py-3 text-slate-700 dark:text-cyan-100 focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                  <div>
                    <TooltipLabel 
                      label="撰稿人模型" 
                      title="正文撰写模型" 
                      desc="负责根据大纲和检索结果撰写长文。建议使用长文本生成能力强的模型，如 qwen-plus。" 
                    />
                    <input type="text" value={settings.model_writer} onChange={e => handleChange('model_writer', e.target.value)} className="w-full bg-slate-50 dark:bg-[#030712] border border-slate-200 dark:border-cyan-900/50 rounded-xl px-4 py-3 text-slate-700 dark:text-cyan-100 focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                </div>
                <div>
                  <TooltipLabel 
                    label="网络代理 (可选)" 
                    title="API 网络代理" 
                    desc="如果您的 NAS 无法直连 API，请在此输入代理地址。透明代理用户可留空。" 
                  />
                  <input type="text" value={settings.http_proxy} onChange={e => handleChange('http_proxy', e.target.value)} placeholder="http://192.168.10.12:7890" className="w-full bg-slate-50 dark:bg-[#030712] border border-slate-200 dark:border-cyan-900/50 rounded-xl px-4 py-3 text-slate-700 dark:text-cyan-100 focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <button 
                  onClick={() => testConnection('llm')}
                  disabled={testStatus.llm === 'loading' || !settings.aliyun_api_key}
                  className="w-full mt-4 bg-slate-100 hover:bg-slate-200 dark:bg-cyan-900/30 dark:hover:bg-cyan-800/50 text-slate-700 dark:text-cyan-300 font-medium py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {testStatus.llm === 'loading' ? <Loader2 className="w-5 h-5 animate-spin" /> : '测试连接'}
                  {testStatus.llm === 'success' && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
              <div className="text-center mb-8">
                <Server className="w-12 h-12 text-blue-500 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-slate-800 dark:text-cyan-50">第三步：知识检索</h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm mt-2">配置博查 API，赋予 AI 联网搜索最新资料的能力。</p>
              </div>
              <div className="space-y-4">
                <div>
                  <TooltipLabel 
                    label="博查 API Key" 
                    title="博查 Web Search API" 
                    desc="用于联网检索最新资料。请前往博查开放平台 (bochaai.com) 注册并获取 API Key。" 
                  />
                  <input type="password" value={settings.bocha_api_key} onChange={e => handleChange('bocha_api_key', e.target.value)} placeholder="sk-..." className="w-full bg-slate-50 dark:bg-[#030712] border border-slate-200 dark:border-cyan-900/50 rounded-xl px-4 py-3 text-slate-700 dark:text-cyan-100 focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <TooltipLabel 
                    label="网络代理 (可选)" 
                    title="检索网络代理" 
                    desc="如果您的 NAS 无法直连博查 API，请在此输入代理地址。" 
                  />
                  <input type="text" value={settings.http_proxy} onChange={e => handleChange('http_proxy', e.target.value)} placeholder="http://192.168.10.12:7890" className="w-full bg-slate-50 dark:bg-[#030712] border border-slate-200 dark:border-cyan-900/50 rounded-xl px-4 py-3 text-slate-700 dark:text-cyan-100 focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <button 
                  onClick={() => testConnection('search')}
                  disabled={testStatus.search === 'loading' || !settings.bocha_api_key}
                  className="w-full mt-4 bg-slate-100 hover:bg-slate-200 dark:bg-cyan-900/30 dark:hover:bg-cyan-800/50 text-slate-700 dark:text-cyan-300 font-medium py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {testStatus.search === 'loading' ? <Loader2 className="w-5 h-5 animate-spin" /> : '测试连接'}
                  {testStatus.search === 'success' && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
              <div className="text-center mb-8">
                <MessageSquare className="w-12 h-12 text-blue-500 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-slate-800 dark:text-cyan-50">第四步：网络与触达 (可选)</h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm mt-2">配置 Telegram 代理及消息推送服务。</p>
              </div>
              <div className="space-y-4">
                <div>
                  <TooltipLabel 
                    label="Telegram 网络代理 (SOCKS5/HTTP)" 
                    title="Telegram 代理配置" 
                    desc="用于解决国内 NAS 无法直连 Telegram 的问题。格式如：socks5h://192.168.10.2:1070 或 http://127.0.0.1:7890。仅对 Telegram 推送生效。" 
                  />
                  <input type="text" value={settings.http_proxy} onChange={e => handleChange('http_proxy', e.target.value)} placeholder="socks5h://192.168.10.2:1070" className="w-full bg-slate-50 dark:bg-[#030712] border border-slate-200 dark:border-cyan-900/50 rounded-xl px-4 py-3 text-slate-700 dark:text-cyan-100 focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <TooltipLabel 
                      label="TG Bot Token" 
                      title="TG 机器人 Token" 
                      desc="向 @BotFather 申请的机器人 Token。" 
                    />
                    <input type="password" value={settings.tg_bot_token} onChange={e => handleChange('tg_bot_token', e.target.value)} className="w-full bg-slate-50 dark:bg-[#030712] border border-slate-200 dark:border-cyan-900/50 rounded-xl px-4 py-3 text-slate-700 dark:text-cyan-100 focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                  <div>
                    <TooltipLabel 
                      label="TG Chat ID" 
                      title="TG 接收者 ID" 
                      desc="接收通知的用户或群组 ID。" 
                    />
                    <input type="text" value={settings.tg_chat_id} onChange={e => handleChange('tg_chat_id', e.target.value)} className="w-full bg-slate-50 dark:bg-[#030712] border border-slate-200 dark:border-cyan-900/50 rounded-xl px-4 py-3 text-slate-700 dark:text-cyan-100 focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <TooltipLabel 
                      label="飞书 App ID" 
                      title="飞书自建应用 App ID" 
                      desc="在飞书开放平台自建应用的“凭证与基础信息”中获取。" 
                    />
                    <input type="text" value={settings.feishu_app_id} onChange={e => handleChange('feishu_app_id', e.target.value)} placeholder="cli_..." className="w-full bg-slate-50 dark:bg-[#030712] border border-slate-200 dark:border-cyan-900/50 rounded-xl px-4 py-3 text-slate-700 dark:text-cyan-100 focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                  <div>
                    <TooltipLabel 
                      label="飞书 App Secret" 
                      title="飞书自建应用 App Secret" 
                      desc="在飞书开放平台自建应用的“凭证与基础信息”中获取。" 
                    />
                    <input type="password" value={settings.feishu_app_secret} onChange={e => handleChange('feishu_app_secret', e.target.value)} placeholder="***" className="w-full bg-slate-50 dark:bg-[#030712] border border-slate-200 dark:border-cyan-900/50 rounded-xl px-4 py-3 text-slate-700 dark:text-cyan-100 focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                </div>
                <button 
                  onClick={() => testConnection('push')}
                  disabled={testStatus.push === 'loading' || (!settings.tg_bot_token && !settings.feishu_app_id)}
                  className="w-full mt-4 bg-slate-100 hover:bg-slate-200 dark:bg-cyan-900/30 dark:hover:bg-cyan-800/50 text-slate-700 dark:text-cyan-300 font-medium py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {testStatus.push === 'loading' ? <Loader2 className="w-5 h-5 animate-spin" /> : '测试推送'}
                  {testStatus.push === 'success' && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                </button>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between mt-10 pt-6 border-t border-slate-100 dark:border-cyan-900/30">
            {step > 1 ? (
              <button 
                onClick={() => setStep(s => s - 1)}
                className="px-6 py-2.5 text-slate-500 hover:text-slate-800 dark:text-cyan-400 dark:hover:text-cyan-300 font-medium transition-colors"
              >
                上一步
              </button>
            ) : <div></div>}
            
            {step < 4 ? (
              <button 
                onClick={handleNext}
                className="px-8 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-500/30 transition-all flex items-center gap-2"
              >
                下一步 <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button 
                onClick={handleSubmit}
                disabled={loading}
                className="px-8 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white font-bold rounded-xl shadow-lg shadow-emerald-500/30 transition-all flex items-center gap-2"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : '完成初始化并启动系统'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
