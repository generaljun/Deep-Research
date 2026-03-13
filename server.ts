import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import OpenAI from 'openai';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execAsync = promisify(exec);

console.log('------------------------------------------------');
console.log(`🚀 Server starting...`);
console.log(`💻 System: ${os.platform()} (${os.arch()})`);
console.log(`📦 Node: ${process.version}`);
console.log('------------------------------------------------');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// ==========================================
// 1. Logging Setup (with rotation)
// ==========================================
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const getLogFile = () => path.join(logDir, `app-${new Date().toISOString().split('T')[0]}.log`);

const logger = {
  info: (msg: string) => appendLog('INFO', msg),
  warn: (msg: string) => appendLog('WARN', msg),
  error: (msg: string) => appendLog('ERROR', msg),
};

function appendLog(level: string, msg: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${msg}\n`;
  console.log(line.trim());
  fs.appendFileSync(getLogFile(), line);
}

function appendTaskLog(taskId: string, level: string, msg: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${msg}\n`;
  const taskLogFile = path.join(logDir, `task-${taskId}.log`);
  fs.appendFileSync(taskLogFile, line);
  
  // Keep only 10 most recent task logs
  try {
    const files = fs.readdirSync(logDir).filter(f => f.startsWith('task-') && f.endsWith('.log'));
    if (files.length > 10) {
      const sortedFiles = files.map(f => ({
        name: f,
        time: fs.statSync(path.join(logDir, f)).mtime.getTime()
      })).sort((a, b) => b.time - a.time);
      
      const filesToDelete = sortedFiles.slice(10);
      filesToDelete.forEach(f => {
        fs.unlinkSync(path.join(logDir, f.name));
      });
    }
  } catch (e) {
    console.error('Task log rotation failed:', e);
  }
}

// Clean logs older than 7 days
setInterval(() => {
  try {
    const files = fs.readdirSync(logDir);
    const now = Date.now();
    files.forEach(file => {
      const filePath = path.join(logDir, file);
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs > 7 * 24 * 60 * 60 * 1000) {
        fs.unlinkSync(filePath);
        logger.info(`Deleted old log file: ${file}`);
      }
    });
  } catch (e) {
    console.error('Log rotation failed:', e);
  }
}, 24 * 60 * 60 * 1000);

// ==========================================
// 2. Database Setup (SQLite)
// ==========================================
let db: Database.Database;
try {
  const dataDir = process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    console.log(`Creating data directory: ${dataDir}`);
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = process.env.DB_PATH || path.join(dataDir, 'database.sqlite');
  console.log(`Initializing database at: ${dbPath}`);
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      topic TEXT,
      status TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE,
      password_hash TEXT,
      salt TEXT,
      role TEXT,
      must_change_password INTEGER DEFAULT 0,
      quota INTEGER DEFAULT 3,
      daily_limit INTEGER DEFAULT 3,
      total_quota INTEGER DEFAULT 10,
      used_quota INTEGER DEFAULT 0,
      daily_used INTEGER DEFAULT 0,
      last_reset_date TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS login_attempts (
      ip TEXT PRIMARY KEY,
      attempts INTEGER DEFAULT 0,
      tier INTEGER DEFAULT 0,
      lock_until DATETIME
    );
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      title TEXT,
      topic TEXT,
      user TEXT,
      feishu_url TEXT,
      html_path TEXT,
      md_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  // Migration: add new columns if they don't exist
  try {
    const columns = db.prepare("PRAGMA table_info(users)").all() as any[];
    const colNames = columns.map(c => c.name);
    if (!colNames.includes('quota')) {
      db.exec("ALTER TABLE users ADD COLUMN quota INTEGER DEFAULT 3");
      console.log("Migration: Added quota column to users table");
    }
    if (!colNames.includes('daily_limit')) {
      db.exec("ALTER TABLE users ADD COLUMN daily_limit INTEGER DEFAULT 3");
      console.log("Migration: Added daily_limit column to users table");
    }
    if (!colNames.includes('total_quota')) {
      db.exec("ALTER TABLE users ADD COLUMN total_quota INTEGER DEFAULT 10");
      console.log("Migration: Added total_quota column to users table");
    }
    if (!colNames.includes('used_quota')) {
      db.exec("ALTER TABLE users ADD COLUMN used_quota INTEGER DEFAULT 0");
      console.log("Migration: Added used_quota column to users table");
    }
    if (!colNames.includes('daily_used')) {
      db.exec("ALTER TABLE users ADD COLUMN daily_used INTEGER DEFAULT 0");
      console.log("Migration: Added daily_used column to users table");
    }
    if (!colNames.includes('last_reset_date')) {
      db.exec("ALTER TABLE users ADD COLUMN last_reset_date TEXT");
      console.log("Migration: Added last_reset_date column to users table");
    }
  } catch (e) {
    console.error("Migration error:", e);
  }

  console.log('Database initialized successfully');
} catch (err) {
  console.error('CRITICAL: Database initialization failed!');
  console.error(err);
  process.exit(1);
}

// 僵尸任务自愈机制：启动时将所有 running 状态的任务重置为 failed
const zombieTasks = db.prepare("UPDATE tasks SET status = 'failed' WHERE status = 'running'").run();
if (zombieTasks.changes > 0) {
  logger.warn(`[系统自愈] 发现并清理了 ${zombieTasks.changes} 个因系统意外重启导致的僵尸任务。`);
}

const getSetting = (key: string, defaultValue = '') => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
  return (row && row.value) ? row.value : defaultValue;
};

const setSetting = (key: string, value: string) => {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
};

// ==========================================
// 3. Auth & Security Helpers
// ==========================================
let jwtSecret = getSetting('jwt_secret');
if (!jwtSecret) {
  jwtSecret = crypto.randomBytes(32).toString('hex');
  setSetting('jwt_secret', jwtSecret);
  logger.info('Generated new JWT secret');
} else {
  logger.info('Loaded existing JWT secret');
}

const hashPassword = (password: string, salt: string) => {
  return crypto.scryptSync(password, salt, 64).toString('hex');
};

// Initialize default admin if no users exist
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as any;
if (userCount.count === 0) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword('admin', salt);
  db.prepare('INSERT INTO users (id, username, password_hash, salt, role, must_change_password) VALUES (?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), 'admin', hash, salt, 'admin', 1);
  logger.info('Default admin user created.');
}

const checkRateLimit = (ip: string) => {
  const record = db.prepare('SELECT * FROM login_attempts WHERE ip = ?').get(ip) as any;
  if (record && record.lock_until) {
    if (new Date(record.lock_until) > new Date()) {
      const minutesLeft = Math.ceil((new Date(record.lock_until).getTime() - Date.now()) / 60000);
      throw new Error(`IP 已被锁定，请在 ${minutesLeft} 分钟后重试。`);
    }
  }
};

const recordFailedLogin = (ip: string) => {
  db.prepare('INSERT OR IGNORE INTO login_attempts (ip, attempts, tier) VALUES (?, 0, 0)').run(ip);
  db.prepare('UPDATE login_attempts SET attempts = attempts + 1 WHERE ip = ?').run(ip);
  const record = db.prepare('SELECT * FROM login_attempts WHERE ip = ?').get(ip) as any;
  
  let lockUntil = null;
  if (record.attempts >= 9) {
    lockUntil = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 day
    db.prepare('UPDATE login_attempts SET tier = 3, lock_until = ? WHERE ip = ?').run(lockUntil.toISOString(), ip);
    logger.warn(`IP ${ip} locked for 24 hours due to 9 failed attempts.`);
  } else if (record.attempts >= 6) {
    lockUntil = new Date(Date.now() + 6 * 60 * 60 * 1000); // 6 hours
    db.prepare('UPDATE login_attempts SET tier = 2, lock_until = ? WHERE ip = ?').run(lockUntil.toISOString(), ip);
    logger.warn(`IP ${ip} locked for 6 hours due to 6 failed attempts.`);
  } else if (record.attempts >= 3) {
    lockUntil = new Date(Date.now() + 10 * 60 * 1000); // 10 mins
    db.prepare('UPDATE login_attempts SET tier = 1, lock_until = ? WHERE ip = ?').run(lockUntil.toISOString(), ip);
    logger.warn(`IP ${ip} locked for 10 minutes due to 3 failed attempts.`);
  }
};

const resetLoginAttempts = (ip: string) => {
  db.prepare('DELETE FROM login_attempts WHERE ip = ?').run(ip);
};

// Middleware
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];
  
  // Also check query parameter (useful for direct file downloads via <a> tags)
  if (!token && req.query.token) {
    token = req.query.token as string;
  }

  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  jwt.verify(token, jwtSecret, (err: any, user: any) => {
    if (err) return res.status(403).json({ error: 'Forbidden' });
    req.user = user;
    next();
  });
};

const requireAdmin = (req: any, res: any, next: any) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
};

// ==========================================
// 4. SSE & Helper Functions
// ==========================================
const taskEvents = new EventEmitter();

let currentRunningTask: { taskId: string, username: string, topic: string } | null = null;

const broadcastSystemStatus = () => {
  const status = JSON.stringify({
    type: 'system_status',
    data: { isBusy: currentRunningTask !== null, currentTask: currentRunningTask }
  });
  taskEvents.emit('system_status', status);
};

const broadcastLog = (taskId: string, message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
  const logEntry = JSON.stringify({ timestamp: new Date().toISOString(), message, type });
  taskEvents.emit(`log-${taskId}`, logEntry);
  logger.info(`[Task ${taskId}] ${message}`);
  appendTaskLog(taskId, type.toUpperCase(), message);
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const withRetry = async <T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      if (i === retries - 1) throw error;
      logger.warn(`[Retry ${i + 1}/${retries}] Error: ${error.message}. Retrying in ${delay}ms...`);
      await sleep(delay);
      delay *= 2;
    }
  }
  throw new Error('Unreachable');
};

const getProxyAgent = (proxyUrl: string) => {
  if (!proxyUrl) return undefined;
  if (proxyUrl.startsWith('socks')) {
    return new SocksProxyAgent(proxyUrl);
  }
  return new HttpsProxyAgent(proxyUrl);
};

const getLLMClient = () => {
  const apiKey = getSetting('aliyun_api_key');
  const baseURL = getSetting('llm_base_url', 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  const proxyUrl = getSetting('http_proxy');
  
  if (!apiKey) throw new Error('未配置大模型 API Key，请前往后台设置。');
  
  const options: any = { 
    apiKey, 
    baseURL,
    timeout: 300000, // 增加到 300 秒 (5 分钟)，防止撰写长章节时超时
    maxRetries: 2
  };

  if (proxyUrl) {
    const agent = getProxyAgent(proxyUrl);
    options.httpAgent = agent;
    options.httpsAgent = agent;
  }
  
  return new OpenAI(options);
};

const searchBocha = async (query: string) => {
  const apiKey = getSetting('bocha_api_key');
  const proxyUrl = getSetting('http_proxy');
  
  if (!apiKey) throw new Error('未配置博查 API Key，请前往后台设置。');
  
  const axiosConfig: any = {
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    family: 4 // 强制使用 IPv4，解决部分 NAS 环境 IPv6 路由问题
  };

  if (proxyUrl) {
    const agent = getProxyAgent(proxyUrl);
    axiosConfig.httpsAgent = agent;
    axiosConfig.httpAgent = agent;
    axiosConfig.proxy = false;
  }

  const response = await axios.post(
    'https://api.bochaai.com/v1/web-search',
    { query, freshness: "noLimit", summary: true, count: 10 },
    axiosConfig
  );
  
  const results = response.data?.data?.webPages?.value || [];
  return results.slice(0, 8).map((r: any) => `- [${r.name}](${r.url}): ${r.snippet}`).join('\n');
};

const sendNotifications = async (message: string) => {
  const tgToken = getSetting('tg_bot_token');
  const tgChatId = getSetting('tg_chat_id');
  const feishuAppId = getSetting('feishu_app_id');
  const feishuAppSecret = getSetting('feishu_app_secret');
  const proxyUrl = getSetting('http_proxy');

  if (tgToken && tgChatId) {
    const axiosConfig: any = { family: 4 };
    if (proxyUrl) {
      const agent = getProxyAgent(proxyUrl);
      axiosConfig.httpsAgent = agent;
      axiosConfig.httpAgent = agent;
    }
    try {
      await axios.post(`https://api.telegram.org/bot${tgToken}/sendMessage`, 
        { chat_id: tgChatId, text: message },
        axiosConfig
      );
    } catch (e: any) { logger.error(`TG Notification failed: ${e.message}`); }
  }

  // 飞书消息通知 (如果有配置 App ID/Secret，可以通过机器人发送)
  if (feishuAppId && feishuAppSecret) {
    try {
      const token = await getFeishuToken();
      // 这里可以实现发送飞书消息，但用户主要需求是创建文档，通知可以复用 TG 或简单实现
      logger.info('Feishu App configured, notifications can be sent via Feishu Doc links.');
    } catch (e: any) { logger.error(`Feishu Notification failed: ${e.message}`); }
  }
};

const getFeishuToken = async () => {
  const appId = getSetting('feishu_app_id');
  const appSecret = getSetting('feishu_app_secret');
  if (!appId || !appSecret) return null;

  const res = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: appId,
    app_secret: appSecret
  });
  return res.data.tenant_access_token;
};

const createFeishuDoc = async (title: string) => {
  const token = await getFeishuToken();
  if (!token) return null;

  const res = await axios.post('https://open.feishu.cn/open-apis/docx/v1/documents', {
    title: title
  }, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (res.data.code === 0) {
    return res.data.data.document;
  }
  throw new Error(`创建飞书文档失败: ${res.data.msg}`);
};

const appendToFeishuDoc = async (documentId: string, markdown: string) => {
  const token = await getFeishuToken();
  if (!token) return;

  const lines = markdown.split('\n').map(l => l.trim()).filter(l => l !== '');
  if (lines.length === 0) return;

  const children: any[] = [];
  for (const line of lines) {
    try {
      if (line.startsWith('# ')) {
        children.push({ block_type: 3, heading1: { elements: [{ text_run: { content: line.replace('# ', '') } }] } });
      } else if (line.startsWith('## ')) {
        children.push({ block_type: 4, heading2: { elements: [{ text_run: { content: line.replace('## ', '') } }] } });
      } else if (line.startsWith('### ')) {
        children.push({ block_type: 5, heading3: { elements: [{ text_run: { content: line.replace('### ', '') } }] } });
      } else {
        // 限制单行长度，防止飞书 API 报错
        const safeText = line.substring(0, 2000);
        children.push({ block_type: 2, text: { elements: [{ text_run: { content: safeText } }] } });
      }
    } catch (e) {
      logger.error(`Error parsing line for Feishu: ${line}`);
    }
  }

  if (children.length === 0) return;

  try {
    // 飞书 API 限制单次追加 block 数量（通常为 50-100）
    // 我们需要分批发送
    const batchSize = 50;
    for (let i = 0; i < children.length; i += batchSize) {
      const batch = children.slice(i, i + batchSize);
      await axios.post(`https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks/${documentId}/children`, {
        children: batch,
        index: -1
      }, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
    }
  } catch (e: any) {
    const errorMsg = e.response?.data?.msg || e.message;
    logger.error(`Feishu append failed: ${errorMsg}`);
    throw new Error(`飞书文档追加失败: ${errorMsg}`);
  }
};

import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import toc from 'markdown-it-table-of-contents';

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
});
md.use(anchor, { permalink: anchor.permalink.headerLink() });
md.use(toc);

const generateHtmlReport = (title: string, markdown: string, feishuUrl?: string, createdAt?: string) => {
  // Remove the first h1 heading from the markdown to avoid duplication with the HTML header
  let cleanMarkdown = markdown.replace(/^#\s+.*?\n/, '');
  
  // Fix malformed headings like "### ### Heading" or "#### ### Heading"
  cleanMarkdown = cleanMarkdown.replace(/^ {0,3}(#{1,6})\s+#{1,6}\s+/gm, '$1 ');
  
  // Fix missing spaces after heading markers like "###Heading"
  cleanMarkdown = cleanMarkdown.replace(/^ {0,3}(#{1,6})([^#\s])/gm, '$1 $2');
  
  // Fix headings wrapped in bold tags like "**### Heading**"
  cleanMarkdown = cleanMarkdown.replace(/^ {0,3}\*\*(#{1,6})\s+(.*?)\*\*/gm, '$1 **$2**');
  
  const content = md.render(cleanMarkdown);
  // Calculate word count (simplified: count characters excluding whitespace)
  const wordCount = cleanMarkdown.replace(/\s+/g, '').length;
  const readingTime = Math.ceil(wordCount / 500); // Assume 500 chars per minute
  const displayTime = createdAt 
    ? new Date(createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) 
    : new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Noto+Sans+SC:wght@400;500;700&display=swap');
        :root { 
            --bg-color: #f8fafc; 
            --text-color: #1e293b; 
            --card-bg: #ffffff; 
            --border-color: rgba(0,0,0,0.1);
            --table-header-bg: rgba(0,0,0,0.05);
            --link-color: #3b82f6;
            --toc-active-bg: rgba(59, 130, 246, 0.1);
        }
        .dark-theme { 
            --bg-color: #0f172a; 
            --text-color: #f1f5f9; 
            --card-bg: #1e293b; 
            --border-color: rgba(255,255,255,0.1);
            --table-header-bg: rgba(255,255,255,0.05);
            --link-color: #60a5fa;
            --toc-active-bg: rgba(96, 165, 250, 0.15);
        }
        .sepia-theme { 
            --bg-color: #fdf6e3; 
            --text-color: #586e75; 
            --card-bg: #eee8d5; 
            --border-color: rgba(88,110,117,0.2);
            --table-header-bg: rgba(88,110,117,0.1);
            --link-color: #268bd2;
            --toc-active-bg: rgba(38, 139, 210, 0.15);
        }
        
        body { font-family: 'Inter', 'Noto Sans SC', sans-serif; background-color: var(--bg-color); color: var(--text-color); transition: all 0.3s ease; overflow-x: hidden; overscroll-behavior-x: none; }
        html { overflow-x: hidden; }
        .prose { max-width: 65ch; margin: 0 auto; font-size: 1.25rem; }
        .prose h1 { font-size: 2.75rem; font-weight: 800; margin-top: 2rem; margin-bottom: 1rem; color: inherit; }
        .prose h2 { font-size: 2rem; font-weight: 700; margin-top: 2rem; margin-bottom: 0.75rem; color: inherit; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem; }
        .prose h3 { font-size: 1.5rem; font-weight: 600; margin-top: 1.5rem; margin-bottom: 0.5rem; color: inherit; }
        .prose p { margin-top: 1rem; margin-bottom: 1rem; line-height: 1.75; color: inherit; opacity: 0.9; text-indent: 2em; }
        .prose table { width: 100%; border-collapse: collapse; margin-top: 1.5rem; margin-bottom: 1.5rem; font-size: 1.125rem; background: var(--card-bg); color: var(--text-color); }
        .table-wrapper { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 1.5rem 0; border-radius: 0.5rem; border: 1px solid var(--border-color); overscroll-behavior-x: contain; }
        .prose table { margin: 0; border: none; }
        .chart-wrapper { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 2rem 0; padding: 1rem; background: var(--card-bg); border-radius: 1rem; border: 1px solid var(--border-color); overscroll-behavior-x: contain; }
        .chart-container { min-width: 600px; height: 400px; position: relative; }
        .prose th { background-color: var(--table-header-bg); border: 1px solid var(--border-color); padding: 0.75rem; text-align: left; font-weight: 600; color: var(--text-color); }
        .prose td { border: 1px solid var(--border-color); padding: 0.75rem; color: var(--text-color); }
        
        #toc { position: fixed; left: 2rem; top: 6rem; width: 280px; max-height: calc(100vh - 8rem); overflow-y: auto; padding: 1.5rem; background: var(--card-bg); border-radius: 1rem; border: 1px solid var(--border-color); display: none; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); scrollbar-width: thin; z-index: 40; }
        @media (min-width: 1280px) { #toc { display: block; } }
        #toc ul { list-style: none; padding-left: 0; margin: 0; }
        #toc li { margin-bottom: 0.1rem; font-size: 0.875rem; line-height: 1.4; }
        .toc-item-container { display: flex; align-items: flex-start; border-radius: 0.375rem; transition: background 0.2s; margin-bottom: 2px; }
        .toc-item-container:hover { background: var(--table-header-bg); }
        .toc-toggle { width: 1.5rem; height: 1.5rem; display: flex; align-items: center; justify-content: center; cursor: pointer; opacity: 0.4; transition: all 0.2s; flex-shrink: 0; margin-top: 0.1rem; border-radius: 0.25rem; }
        .toc-toggle:hover { opacity: 1; background: var(--border-color); }
        .toc-toggle.collapsed { transform: rotate(-90deg); }
        .toc-toggle svg { width: 14px; height: 14px; }
        #toc a { display: block; flex-grow: 1; padding: 0.3rem 0.5rem; color: var(--text-color); opacity: 0.75; text-decoration: none; transition: all 0.2s; border-left: 2px solid transparent; }
        #toc a:hover { opacity: 1; color: var(--link-color); }
        #toc a.active { opacity: 1; color: var(--link-color); font-weight: 600; background: var(--toc-active-bg); border-left-color: var(--link-color); }
        #toc .toc-h2 { font-weight: 600; }
        #toc .toc-h3 { font-size: 0.8rem; opacity: 0.7; }
        .toc-sublist { display: block; margin-left: 0.75rem; padding-left: 1rem; border-left: 1px solid var(--border-color); margin-bottom: 0.5rem; }
        .toc-sublist.collapsed { display: none; }

        .controls { position: fixed; right: 2rem; bottom: 2rem; display: flex; flex-direction: column; gap: 0.5rem; z-index: 100; }
        .control-btn { position: relative; width: 3rem; height: 3rem; border-radius: 50%; background: var(--card-bg); border: 1px solid var(--border-color); display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); transition: all 0.2s; color: var(--text-color); }
        .control-btn:hover { transform: scale(1.1); background: var(--table-header-bg); }
        .control-btn::before { content: attr(data-tooltip); position: absolute; right: 100%; top: 50%; transform: translateY(-50%); margin-right: 10px; background: var(--text-color); color: var(--bg-color); padding: 4px 8px; border-radius: 4px; font-size: 12px; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity 0.2s; font-weight: 500; }
        .control-btn:hover::before { opacity: 1; }
        
        #toast { visibility: hidden; min-width: 250px; margin-left: -125px; background-color: #333; color: #fff; text-align: center; border-radius: 8px; padding: 16px; position: fixed; z-index: 1000; left: 50%; bottom: 30px; font-size: 14px; }
        #toast.show { visibility: visible; animation: fadein 0.5s, fadeout 0.5s 2.5s; }
        @keyframes fadein { from {bottom: 0; opacity: 0;} to {bottom: 30px; opacity: 1;} }
        @keyframes fadeout { from {bottom: 30px; opacity: 1;} to {bottom: 0; opacity: 0;} }
    </style>
</head>
<body class="bg-slate-50 text-slate-900 antialiased">
    <nav class="sticky top-0 z-50 bg-white/90 border-b border-slate-200 py-4 px-6 mb-8">
        <div class="max-w-5xl mx-auto flex justify-between items-center">
            <div class="flex items-center space-x-2">
                <div class="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">DR</div>
                <span class="font-bold text-lg tracking-tight">Deep Research Report</span>
            </div>
            <div class="flex items-center space-x-4">
                ${feishuUrl ? `<a href="${feishuUrl}" target="_blank" class="text-sm font-medium text-emerald-600 hover:text-emerald-700 transition-colors">飞书文档</a>` : ''}
                <button onclick="shareReport()" class="flex items-center space-x-1 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-sm font-bold hover:bg-blue-100 transition-all">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                    <span>分享</span>
                </button>
                <button onclick="window.print()" class="text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors">打印</button>
            </div>
        </div>
    </nav>

    <div id="toc">
        <h3 class="text-xs font-bold uppercase tracking-wider mb-4 opacity-40">目录</h3>
        <ul id="toc-list"></ul>
    </div>

    <main class="max-w-4xl mx-auto px-4 pb-24">
        <header class="mb-12 text-center">
            <h1 class="text-4xl md:text-5xl font-extrabold mb-4">${title}</h1>
            <div class="flex flex-wrap justify-center items-center gap-4 opacity-60 text-sm">
                <span>生成时间: ${displayTime}</span>
                <span>•</span>
                <span>全文共计: ${wordCount} 字</span>
                <span>•</span>
                <span>预计阅读: ${readingTime} 分钟</span>
            </div>
        </header>

        <div id="report-content" class="prose prose-slate lg:prose-xl">
            ${content}
        </div>

        <div class="mt-16 pt-8 border-t border-[var(--border-color)] flex flex-col sm:flex-row items-center justify-center gap-4">
            <a href="/?tab=reports" class="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-all shadow-lg shadow-blue-900/20 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                返回报告库
            </a>
            <a href="/?tab=generator" class="px-6 py-3 bg-[var(--card-bg)] hover:bg-[var(--table-header-bg)] text-[var(--text-color)] border border-[var(--border-color)] rounded-xl font-bold transition-all flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
                生成新报告
            </a>
            <button onclick="window.scrollTo({top: 0, behavior: 'smooth'})" class="px-6 py-3 bg-[var(--card-bg)] hover:bg-[var(--table-header-bg)] text-[var(--text-color)] border border-[var(--border-color)] rounded-xl font-bold transition-all flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                回到顶部
            </button>
        </div>
    </main>

    <div class="controls">
        <button onclick="window.scrollTo({top: 0, behavior: 'smooth'})" class="control-btn" data-tooltip="回到顶部">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
        </button>
        <button onclick="toggleTheme()" class="control-btn" data-tooltip="切换阅读模式">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
        </button>
        <button onclick="changeFontSize(1)" class="control-btn" data-tooltip="放大字体">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M9 12h6"/><path d="M12 9v6"/></svg>
        </button>
        <button onclick="changeFontSize(-1)" class="control-btn" data-tooltip="缩小字体">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M9 12h6"/></svg>
        </button>
    </div>

    <div id="toast">链接已成功复制到剪贴板</div>

    <footer class="bg-white/50 border-t border-slate-200 py-12">
        <div class="max-w-4xl mx-auto px-4 text-center opacity-50 text-sm">
            <p>© ${new Date().getFullYear()} Deep Research Web. All rights reserved.</p>
            <p class="mt-2">本报告内容由 AI 生成，仅供参考，不代表任何投资建议。</p>
        </div>
    </footer>

    <script>
        // TOC Generation and Scroll Spy
        const content = document.getElementById('report-content');
        const tocList = document.getElementById('toc-list');
        const headings = content.querySelectorAll('h2, h3');
        const tocLinks = [];
        
        let h2Counter = 0;
        let h3Counter = 0;
        let currentSublist = null;
        
        headings.forEach((heading, index) => {
            const id = 'heading-' + index;
            heading.id = id;
            
            let prefix = '';
            const li = document.createElement('li');
            const container = document.createElement('div');
            container.className = 'toc-item-container';
            
            const a = document.createElement('a');
            a.href = '#' + id;
            
            if (heading.tagName === 'H2') {
                h2Counter++;
                h3Counter = 0;
                prefix = h2Counter + '. ';
                a.textContent = prefix + heading.textContent;
                a.className = 'toc-h2';
                
                const toggle = document.createElement('span');
                toggle.className = 'toc-toggle';
                toggle.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
                
                container.appendChild(toggle);
                container.appendChild(a);
                li.appendChild(container);
                
                currentSublist = document.createElement('ul');
                currentSublist.className = 'toc-sublist';
                li.appendChild(currentSublist);
                
                const thisSublist = currentSublist;
                const toggleSublist = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggle.classList.toggle('collapsed');
                    thisSublist.classList.toggle('collapsed');
                };
                
                toggle.onclick = toggleSublist;
                
                // Allow clicking the container (except the link text) to toggle
                container.onclick = (e) => {
                    if (e.target !== a) {
                        toggleSublist(e);
                    }
                };
                
                tocList.appendChild(li);
            } else if (heading.tagName === 'H3') {
                h3Counter++;
                prefix = h2Counter + '.' + h3Counter + ' ';
                a.textContent = prefix + heading.textContent;
                a.className = 'toc-h3';
                
                container.appendChild(a);
                li.appendChild(container);
                
                if (currentSublist) {
                    currentSublist.appendChild(li);
                } else {
                    tocList.appendChild(li);
                }
            }
            
            tocLinks.push({ id, element: a });
        });
        
        // Hide toggle if no children
        tocList.querySelectorAll('.toc-toggle').forEach(toggle => {
            const sublist = toggle.closest('li').querySelector('.toc-sublist');
            if (!sublist || sublist.children.length === 0) {
                toggle.style.visibility = 'hidden';
                if (sublist) sublist.style.display = 'none';
            }
        });

        // Intersection Observer for Scroll Spy
        const observerOptions = {
            root: null,
            rootMargin: '-100px 0px -60% 0px',
            threshold: 0
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    tocLinks.forEach(link => link.element.classList.remove('active'));
                    const activeLink = tocLinks.find(link => link.id === entry.target.id);
                    if (activeLink) {
                        activeLink.element.classList.add('active');
                        
                        // Expand parent if it's collapsed
                        const parentSublist = activeLink.element.closest('.toc-sublist');
                        if (parentSublist && parentSublist.classList.contains('collapsed')) {
                            parentSublist.classList.remove('collapsed');
                            const parentToggle = parentSublist.parentElement.querySelector('.toc-toggle');
                            if (parentToggle) {
                                parentToggle.classList.remove('collapsed');
                            }
                        }
                        
                        const tocContainer = document.getElementById('toc');
                        const linkRect = activeLink.element.getBoundingClientRect();
                        const tocRect = tocContainer.getBoundingClientRect();
                        if (linkRect.bottom > tocRect.bottom || linkRect.top < tocRect.top) {
                            activeLink.element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        }
                    }
                }
            });
        }, observerOptions);

        headings.forEach(heading => observer.observe(heading));

        // Theme Toggle
        let currentTheme = 0; // 0: light, 1: dark, 2: sepia
        function toggleTheme() {
            currentTheme = (currentTheme + 1) % 3;
            document.body.classList.remove('dark-theme', 'sepia-theme');
            if (currentTheme === 1) document.body.classList.add('dark-theme');
            if (currentTheme === 2) document.body.classList.add('sepia-theme');
        }

        // Font Size
        let baseSize = 18;
        function changeFontSize(delta) {
            baseSize = Math.max(12, Math.min(32, baseSize + delta * 2));
            content.style.fontSize = baseSize + 'px';
        }

        function shareReport() {
            const url = window.location.href;
            const toast = document.getElementById("toast");
            navigator.clipboard.writeText(url).then(() => {
                toast.className = "show";
                setTimeout(() => { toast.className = ""; }, 3000);
            });
        }
        
        hljs.highlightAll();
    </script>

    <script>
        // 自动识别表格并生成图表
        document.querySelectorAll('table').forEach((table, index) => {
            // Wrap table for horizontal scroll
            const wrapper = document.createElement('div');
            wrapper.className = 'table-wrapper';
            table.parentNode.insertBefore(wrapper, table);
            wrapper.appendChild(table);

            const rows = Array.from(table.querySelectorAll('tr'));
            if (rows.length < 2) return;

            // 获取表头
            let headerCells = Array.from(rows[0].querySelectorAll('th, td'));
            if (headerCells.length === 0) return;
            const headers = headerCells.map(el => el.innerText.trim());
            
            // 获取数据行
            const dataRows = rows.slice(1).filter(row => row.querySelectorAll('td').length === headers.length);
            if (dataRows.length === 0) return;

            // 确定标签列 (通常是第一列)
            const labelColIdx = 0;
            const labels = dataRows.map(row => {
                const cell = row.querySelectorAll('td')[labelColIdx];
                return cell ? cell.innerText.trim() : '';
            });

            // 检查标签是否像年份/时间序列
            const isTimeSeries = labels.length > 0 && labels.every(label => {
                const l = label.trim();
                return /^(20\d{2}|19\d{2})/.test(l) || 
                       /^([1-9]|1[0-2])月/.test(l) || 
                       /^第[一二三四1-4]季度/.test(l) ||
                       /^Q[1-4]/i.test(l) ||
                       /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(l) ||
                       /^\d{4}-\d{2}/.test(l) ||
                       /^\d{4}年\d{1,2}月/.test(l) ||
                       /^\d{4}\.\d{1,2}/.test(l);
            });

            // 寻找数值列 (排除标签列)
            const numericCols = [];
            for (let j = 0; j < headers.length; j++) {
                if (j === labelColIdx) continue; // 不把标签列作为数据列
                
                let validNumberCount = 0;
                for (let i = 0; i < dataRows.length; i++) {
                    const cell = dataRows[i].querySelectorAll('td')[j];
                    if (!cell) continue;
                    const text = cell.innerText.trim();
                    if (text === '' || text === '-') continue; // 允许空值或占位符
                    
                    // 提取数字，允许千分位逗号和百分号
                    const cleanText = text.replace(/,/g, '').replace(/%/g, '');
                    const val = parseFloat(cleanText);
                    if (!isNaN(val)) {
                        validNumberCount++;
                    }
                }
                // 如果该列超过一半是有效数字，则认为是数值列
                if (validNumberCount > 0 && validNumberCount >= dataRows.length / 2) {
                    numericCols.push(j);
                }
            }

            if (numericCols.length > 0) {
                const chartWrapper = document.createElement('div');
                chartWrapper.className = 'chart-wrapper';
                
                const container = document.createElement('div');
                container.className = 'chart-container';
                
                const canvas = document.createElement('canvas');
                canvas.id = 'chart-' + index;
                container.appendChild(canvas);
                chartWrapper.appendChild(container);
                wrapper.parentNode.insertBefore(chartWrapper, wrapper.nextSibling);

                // 决定图表类型
                let chartType = 'bar';
                let indexAxis = 'x';
                if (isTimeSeries) {
                    chartType = 'line';
                } else if (numericCols.length === 1 && labels.length <= 8 && labels.length >= 2) {
                    chartType = 'doughnut';
                } else if (labels.length > 8 && !isTimeSeries) {
                    chartType = 'bar';
                    indexAxis = 'y';
                }

                // 预设一些好看的颜色组合 (Tailwind 风格)
                const colors = [
                    { bg: 'rgba(59, 130, 246, 0.2)', border: 'rgb(59, 130, 246)' }, // Blue
                    { bg: 'rgba(16, 185, 129, 0.2)', border: 'rgb(16, 185, 129)' }, // Emerald
                    { bg: 'rgba(245, 158, 11, 0.2)', border: 'rgb(245, 158, 11)' }, // Amber
                    { bg: 'rgba(139, 92, 246, 0.2)', border: 'rgb(139, 92, 246)' }, // Violet
                    { bg: 'rgba(236, 72, 153, 0.2)', border: 'rgb(236, 72, 153)' }, // Pink
                    { bg: 'rgba(14, 165, 233, 0.2)', border: 'rgb(14, 165, 233)' }, // Sky
                    { bg: 'rgba(249, 115, 22, 0.2)', border: 'rgb(249, 115, 22)' }, // Orange
                    { bg: 'rgba(168, 85, 247, 0.2)', border: 'rgb(168, 85, 247)' }, // Purple
                    { bg: 'rgba(20, 184, 166, 0.2)', border: 'rgb(20, 184, 166)' }, // Teal
                    { bg: 'rgba(239, 68, 68, 0.2)', border: 'rgb(239, 68, 68)' },   // Red
                ];

                const isDoughnut = chartType === 'doughnut' || chartType === 'pie';

                const datasets = numericCols.map((colIdx, i) => {
                    let bgColors, borderColors;
                    if (isDoughnut) {
                        bgColors = labels.map((_, idx) => colors[idx % colors.length].bg.replace('0.2', '0.7'));
                        borderColors = labels.map((_, idx) => colors[idx % colors.length].border);
                    } else {
                        bgColors = colors[i % colors.length].bg;
                        borderColors = colors[i % colors.length].border;
                    }
                    
                    return {
                        label: headers[colIdx],
                        data: dataRows.map(row => {
                            const cell = row.querySelectorAll('td')[colIdx];
                            if (!cell) return null;
                            const text = cell.innerText.trim();
                            if (text === '' || text === '-') return null;
                            const cleanText = text.replace(/,/g, '').replace(/%/g, '');
                            const val = parseFloat(cleanText);
                            return isNaN(val) ? null : val;
                        }),
                        backgroundColor: bgColors,
                        borderColor: borderColors,
                        borderWidth: 2,
                        tension: 0.3, // 平滑曲线
                        fill: chartType === 'line' && numericCols.length === 1 // 只有单条线时才填充面积
                    };
                });
                
                // 尝试获取表格上方的标题
                let chartTitle = '数据可视化: ' + headers[0] + '相关数据';
                let currentEl = table.previousElementSibling;
                while (currentEl) {
                    if (currentEl.tagName.match(/^H[1-6]$/)) {
                        chartTitle = currentEl.innerText;
                        break;
                    }
                    if (currentEl.tagName === 'TABLE') break; // 跨过另一个表格则停止
                    currentEl = currentEl.previousElementSibling;
                }

                new Chart(canvas, {
                    type: chartType,
                    data: { labels, datasets },
                    options: {
                        indexAxis: indexAxis,
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: {
                            mode: 'index',
                            intersect: false,
                        },
                        plugins: {
                            legend: { 
                                position: isDoughnut ? 'right' : 'top',
                                labels: { font: { family: "'Inter', 'Noto Sans SC', sans-serif" } }
                            },
                            title: { 
                                display: true, 
                                text: chartTitle,
                                font: { size: 16, family: "'Inter', 'Noto Sans SC', sans-serif", weight: 'bold' }
                            },
                            tooltip: {
                                backgroundColor: 'rgba(17, 24, 39, 0.9)',
                                titleFont: { family: "'Inter', 'Noto Sans SC', sans-serif" },
                                bodyFont: { family: "'Inter', 'Noto Sans SC', sans-serif" },
                                padding: 12,
                                cornerRadius: 8
                            }
                        },
                        scales: isDoughnut ? undefined : {
                            y: {
                                beginAtZero: indexAxis === 'x',
                                grid: { 
                                    display: indexAxis === 'x',
                                    color: 'rgba(243, 244, 246, 1)' 
                                }
                            },
                            x: {
                                beginAtZero: indexAxis === 'y',
                                grid: { 
                                    display: indexAxis === 'y',
                                    color: 'rgba(243, 244, 246, 1)'
                                }
                            }
                        }
                    }
                });
            }
        });
    </script>
</body>
</html>
  `;
};

// ==========================================
// 5. Core Deep Research Engine & Queue
// ==========================================
let runningTask: { id: string, topic: string, user: string, progress: number, status: string } | null = null;
let taskQueue: { id: string, topic: string, user: string }[] = [];

const runDeepResearch = async (taskId: string, topic: string, length: string, user: string) => {
  runningTask = { id: taskId, topic, user, progress: 0, status: 'running' };
  currentRunningTask = { taskId, username: user, topic };
  broadcastSystemStatus();
  const reportsDir = path.join(__dirname, 'reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  
  let filePath = '';
  const modelPlanner = getSetting('model_planner', 'qwen-plus');
  const modelWriter = getSetting('model_writer', 'qwen-plus');

  try {
    broadcastLog(taskId, `🚀 任务启动：${topic}`, 'success');
    await sendNotifications(`🚀 深度研究已启动！\n课题：${topic}\n任务ID：${taskId}`);

    broadcastLog(taskId, `🧠 正在调用规划师 (${modelPlanner}) 生成大纲...`);
    const client = getLLMClient();
    
    const plannerPrompt = `你是一个只输出 JSON 的数据转换接口。
当前日期：2026年3月。请基于此时间背景，对未来趋势进行前瞻性预测。
请根据用户探讨的课题：【${topic}】，生成一份深度研究报告大纲。
预期【正文】篇幅：${length}字（不含执行摘要、参考文献）。必须融入行业特性，体现深度思考。
【致命约束】
1. 严禁偏离主题。所有章节必须紧扣课题：【${topic}】。
2. 绝对禁止输出任何 Markdown 标记（如 \`\`\`json\`）、禁止输出任何问候语或解释。
3. 必须严格遵守以下 JSON 结构：
{
  "report_title": "报告主标题",
  "executive_summary_points": "执行摘要的核心要点，需包含核心发现、行业趋势总结和战略建议",
  "chapters": [
    {
      "chapter_num": 1,
      "chapter_title": "第一章：...",
      "core_points": "本章需要探讨的核心论点，需强调逻辑链条整合与行业深度洞察。请确保本章撰写后的正文字数符合大纲预期的分布。"
    }
  ]
}`;

    let outline;
    try {
      const plannerRes = await withRetry(() => client.chat.completions.create({
        model: modelPlanner,
        messages: [{ role: 'user', content: plannerPrompt }],
        temperature: 0.1,
      }));

      let rawJson = plannerRes.choices[0].message.content || '';
      rawJson = rawJson.replace(/```json/g, '').replace(/```/g, '').trim();
      outline = JSON.parse(rawJson);
    } catch (e: any) {
      const errCode = e.response?.status || e.code || 'UNKNOWN';
      throw new Error(`[大纲规划模块] 生成大纲失败。错误代码: ${errCode}, 原因: ${e.message}`);
    }

    // 生成带时间戳的文件名: 用户名-报告名-生成时间.md
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(now);
    const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const timeStr = `${p.year}${p.month}${p.day}_${p.hour}${p.minute}${p.second}`;
    const safeTitle = outline.report_title.replace(/[\/\\?%*:|"<>]/g, '-');
    filePath = path.join(reportsDir, `${user}-${safeTitle}-${timeStr}.md`);

    runningTask.progress = 10;
    broadcastLog(taskId, `✅ 大纲生成完毕，共 ${outline.chapters.length} 章。准备写入本地文件...`, 'success');
    
    fs.writeFileSync(filePath, `# ${outline.report_title}\n\n> 本报告由 Deep Research Web 自动生成。\n> 课题：${topic}\n\n---\n\n`);

    // 飞书文档初始化
    let feishuDocId: string | null = null;
    try {
      const doc = await createFeishuDoc(outline.report_title);
      if (doc) {
        feishuDocId = doc.document_id;
        broadcastLog(taskId, `📄 飞书文档已创建：https://bytedance.feishu.cn/docx/${feishuDocId}`, 'success');
        await appendToFeishuDoc(feishuDocId, `# ${outline.report_title}\n> 课题：${topic}\n\n`);
      }
    } catch (e: any) {
      broadcastLog(taskId, `⚠️ 飞书文档创建失败: ${e.message}`, 'warning');
    }

    // 生成执行摘要
    try {
      broadcastLog(taskId, `📝 正在撰写执行摘要 (Executive Summary)...`);
      const summaryPrompt = `你是一位顶级的战略咨询顾问。请根据报告标题【${outline.report_title}】和以下核心要点，撰写一份极具洞察力的“执行摘要（Executive Summary）”。
      
核心要点：${outline.executive_summary_points}

要求：
1. 站在行业高度，总结核心发现。
2. 揭示不同信息链条之间的内在逻辑联系。
3. 给出具有前瞻性的战略建议。
4. 篇幅约 500-800 字，直接输出正文，不要任何开场白。`;

      const summaryRes = await withRetry(() => client.chat.completions.create({
        model: modelWriter,
        messages: [{ role: 'user', content: summaryPrompt }],
        temperature: 0.5,
      }));
      
      const summaryContent = `## 执行摘要 (Executive Summary)\n\n${summaryRes.choices[0].message.content || ''}\n\n---\n\n`;
      fs.appendFileSync(filePath, summaryContent);
      if (feishuDocId) await appendToFeishuDoc(feishuDocId, summaryContent);
    } catch (e: any) {
      broadcastLog(taskId, `⚠️ 执行摘要生成失败: ${e.message}`, 'warning');
    }

    for (let i = 0; i < outline.chapters.length; i++) {
      const chapter = outline.chapters[i];
      runningTask.progress = 10 + Math.floor((i / outline.chapters.length) * 80);
      broadcastLog(taskId, `🔍 开始处理：${chapter.chapter_title}`);
      
      let searchResults = '';
      try {
        broadcastLog(taskId, `🌐 正在调用博查 API 检索素材...`);
        searchResults = await withRetry(() => searchBocha(`${topic} ${chapter.chapter_title} ${chapter.core_points}`));
        broadcastLog(taskId, `✅ 检索完成，获取到有效参考素材。`, 'success');
      } catch (e: any) {
        const errCode = e.response?.status || e.code || 'UNKNOWN';
        broadcastLog(taskId, `⚠️ [检索模块] 检索失败，将基于大模型自身知识撰写。错误代码: ${errCode}, 原因: ${e.message}`, 'warning');
        searchResults = '检索失败，请基于大模型自身知识撰写。';
      }

      try {
        broadcastLog(taskId, `✍️ 正在调用撰稿人 (${modelWriter}) 撰写本章正文...`);
        const writerPrompt = `你是一位顶级的学术研究员与行业资深撰稿人。
当前日期：2026年3月。请基于此时间背景，对未来趋势进行前瞻性预测。
请根据【课题名称】、【章节标题】以及提供的【参考素材】，撰写本章的正文内容。

【学术规范与行文要求】
1. 严禁偏离主题：本章正文必须严格围绕【课题名称】、【章节标题】和【核心论点】展开，严禁插入任何与本课题无关的内容（如AI大模型、固态储氢、碳排放等，除非课题本身相关）。
2. 章节编号：本章是报告的第 ${i + 1} 章。请务必使用 Markdown 二级标题（##）作为本章的主标题，例如：“## 第 ${i + 1} 章：${chapter.chapter_title}”。本章内的所有子标题请使用三级（###）或四级（####）标题。
3. 深度剖析：严禁简单的信息堆砌。你必须对搜集到的信息进行“链条式整合”，分析不同现象之间的因果关系、行业底层逻辑以及未来的演进趋势。
4. 行业洞察：融入你作为资深专家的行业思考，对技术瓶颈、市场博弈、政策导向进行深度推演。
5. 可视化图表：请务必在正文中包含至少一个高质量的 Markdown 可视化数据表格。**严禁使用 Mermaid 语法**。在表格前必须提供一个描述性的标题（使用标准的 Markdown 三级或四级标题，例如：### 2025年市场规模对比），以便系统自动生成图表标题。请根据数据类型提供不同结构的表格，例如：时间序列数据（年份/月份/季度作为第一列）、占比数据（单列数值，分类少于8个）、多维对比数据等，以便系统自动渲染为折线图、饼图或柱状图。注意：标题标记（#）不要重复，例如绝对不要写成“### ### 标题”或“#### ### 标题”。
6. 案例分析格式：若涉及案例研究，请使用“【案例分析】”标识，并采用缩进或引用块（>）形式突出显示，包含：背景、核心举措、成效评估、启示。
7. 数据标注规范：
   - 数据引用：所有关键数据必须在句末使用方括号上标形式标注，如 [1]、[2]。
   - 引用格式：参考学术期刊规范（GB/T 7714-2015）。
8. 参考文献列表：必须在本章正文的最后，设立“### 参考文献与数据源”小节，按顺序排列。格式如下：
   - 网页/新闻：[序号] 作者. 标题 [EB/OL]. (发布日期) [引用日期]. URL.
   - 报告/期刊：[序号] 作者. 标题 [J/R]. 刊名/机构, 年份.
   示例：
   [1] 某行业研究中心. 2025-2030年行业深度研究报告 [R]. 某研究机构, 2025.
   [2] 权威新闻网. 行业最新动态观察 [EB/OL]. (2026-01-15) [2026-03-12]. http://...
9. 严禁废话：直接输出正文，绝对不要输出任何开场白或结束语。

课题名称：${topic}
章节标题：${chapter.chapter_title}
核心论点：${chapter.core_points}

参考素材：
${searchResults}`;

        const writerRes = await withRetry(() => client.chat.completions.create({
          model: modelWriter,
          messages: [{ role: 'user', content: writerPrompt }],
          temperature: 0.6,
        }));

        let content = writerRes.choices[0].message.content || '';
        
        // 防止标题重复：如果内容没有以 ## 开头，或者没有包含当前章节标题，则手动加上
        let finalContent = content;
        // 强制确保章节标题是二级标题 (##)
        finalContent = finalContent.replace(/^(#|###|####)\s+(第\s*\d+\s*章.*)/m, '## $2');
        // 修复重复的标题标记，如 "### ### 标题"
        finalContent = finalContent.replace(/^ {0,3}(#{1,6})\s+#{1,6}\s+/gm, '$1 ');
        // 修复缺少空格的标题标记，如 "###标题"
        finalContent = finalContent.replace(/^ {0,3}(#{1,6})([^#\s])/gm, '$1 $2');
        // 修复被加粗的标题标记，如 "**### 标题**"
        finalContent = finalContent.replace(/^ {0,3}\*\*(#{1,6})\s+(.*?)\*\*/gm, '$1 **$2**');
        if (!finalContent.includes(chapter.chapter_title)) {
          finalContent = `## 第 ${i + 1} 章：${chapter.chapter_title}\n\n${finalContent}`;
        }
        
        fs.appendFileSync(filePath, `${finalContent}\n\n`);
        
        // 同步到飞书文档
        if (feishuDocId) {
          try {
            await appendToFeishuDoc(feishuDocId, finalContent);
          } catch (e: any) {
            logger.error(`Feishu append failed: ${e.message}`);
          }
        }

        broadcastLog(taskId, `💾 本章已追加写入本地硬盘。`, 'success');

      } catch (e: any) {
        const errCode = e.response?.status || e.code || 'UNKNOWN';
        broadcastLog(taskId, `❌ [撰写模块] 本章撰写失败。错误代码: ${errCode}, 原因: ${e.message}。已写入降级占位符。`, 'error');
        fs.appendFileSync(filePath, `## ${chapter.chapter_title}\n\n>[系统提示：本章节生成超时或API无响应，为防止工作流中断已跳过，请人工补充]\n\n`);
      }

      if (chapter.chapter_num < outline.chapters.length) {
        broadcastLog(taskId, `⏳ 触发防限流机制，休眠 15 秒...`, 'info');
        await sleep(15000);
      }
    }

    runningTask.progress = 100;
    broadcastLog(taskId, `🎉 全文撰写完毕！报告已保存至：${filePath}`, 'success');
    
    // 生成 HTML 报告
    let htmlPath = '';
    const nowIso = new Date().toISOString();
    try {
      const markdown = fs.readFileSync(filePath, 'utf8');
      const feishuUrl = feishuDocId ? `https://bytedance.feishu.cn/docx/${feishuDocId}` : undefined;
      const htmlContent = generateHtmlReport(outline.report_title, markdown, feishuUrl, nowIso);
      htmlPath = filePath.replace('.md', '.html');
      fs.writeFileSync(htmlPath, htmlContent);
      broadcastLog(taskId, `🌐 交互式 HTML 报告已生成。`, 'success');
    } catch (e: any) {
      logger.error(`HTML report generation failed: ${e.message}`);
    }

    // 存入数据库
    try {
      db.prepare('INSERT INTO reports (id, title, topic, user, feishu_url, html_path, md_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(taskId, outline.report_title, topic, user, feishuDocId ? `https://bytedance.feishu.cn/docx/${feishuDocId}` : null, htmlPath, filePath, nowIso);
    } catch (e: any) {
      logger.error(`Failed to save report to database: ${e.message}`);
    }

    if (feishuDocId) {
      broadcastLog(taskId, `📄 飞书文档已同步完成：https://bytedance.feishu.cn/docx/${feishuDocId}`, 'success');
    }
    
    const webUrl = `/api/reports/${taskId}/view`;
    broadcastLog(taskId, `🔗 Web 预览地址：${webUrl}`, 'success');

    db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('completed', taskId);
    
    const feishuLink = feishuDocId ? `\n飞书文档：https://bytedance.feishu.cn/docx/${feishuDocId}` : '';
    const webLink = `\nWeb 预览：${webUrl}`;
    await sendNotifications(`🎉 深度研究报告生成完毕！\n课题：${topic}${feishuLink}${webLink}\n请前往 NAS 目录查看：${filePath}`);
    taskEvents.emit(`done-${taskId}`, JSON.stringify({ feishuUrl: feishuDocId ? `https://bytedance.feishu.cn/docx/${feishuDocId}` : null, webUrl }));

  } catch (error: any) {
    const errCode = error.response?.status || error.code || 'UNKNOWN';
    logger.error(`[Task ${taskId}] Fatal Error: ${error.message}`);
    broadcastLog(taskId, `❌ [核心调度模块] 发生致命错误。错误代码: ${errCode}, 原因: ${error.message}`, 'error');
    db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('failed', taskId);
    await sendNotifications(`❌ 深度研究任务失败！\n课题：${topic}\n错误代码：${errCode}\n错误信息：${error.message}`);
    taskEvents.emit(`done-${taskId}`);
  } finally {
    runningTask = null;
    currentRunningTask = null;
    broadcastSystemStatus();
    if (taskQueue.length > 0) {
      const nextTask = taskQueue.shift()!;
      runDeepResearch(nextTask.id, nextTask.topic, '2000', nextTask.user);
    }
  }
};

// ==========================================
// 6. API Routes
// ==========================================

// System Version & Update API
const GITHUB_REPO = 'generaljun/Deep-Research';

app.get('/api/system/version', (req, res) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  res.json({ version: pkg.version });
});

app.get('/api/system/check-update', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    const currentVersion = pkg.version;
    
    const response = await axios.get(`https://api.github.com/repos/${GITHUB_REPO}/contents/package.json`, {
      headers: { 'Accept': 'application/vnd.github.v3.raw' }
    });
    
    const remoteVersion = response.data.version;
    const hasUpdate = remoteVersion !== currentVersion;
    
    res.json({
      currentVersion,
      remoteVersion,
      hasUpdate,
      repoUrl: `https://github.com/generaljun/Deep-Research`
    });
  } catch (e: any) {
    logger.error(`Check update failed: ${e.message}`);
    res.status(500).json({ error: '检查更新失败，请稍后重试。' });
  }
});

app.post('/api/system/update', authenticateToken, requireAdmin, async (req, res) => {
  try {
    logger.info('User triggered system update via Web UI.');
    
    // Check if .git exists to see if we can pull
    if (fs.existsSync(path.join(__dirname, '.git'))) {
      // Try git pull
      const { stdout, stderr } = await execAsync('git pull');
      logger.info(`Git pull output: ${stdout}`);
      if (stderr) logger.warn(`Git pull stderr: ${stderr}`);
      
      return res.json({ success: true, message: '代码已同步。如果您使用的是 Docker 部署，请在 NAS 终端执行 docker compose up -d --build 以完成最终更新。' });
    }

    // Docker environment without .git
    logger.info('Docker environment detected. Starting background update process...');
    
    const url = `https://github.com/${GITHUB_REPO}/archive/refs/heads/main.tar.gz`;
    const updatePath = path.join(__dirname, 'update.tar.gz');
    
    // Send response immediately so the UI doesn't timeout
    res.json({ success: true, message: '系统正在后台下载更新并编译，这可能需要几分钟时间。更新完成后系统会自动重启，请稍后刷新页面。' });
    
    // Run update process in background
    setTimeout(async () => {
      try {
        logger.info(`Downloading update from ${url}...`);
        const response = await axios({
          method: 'GET',
          url: url,
          responseType: 'stream'
        });
        
        const writer = fs.createWriteStream(updatePath);
        response.data.pipe(writer);
        
        await new Promise((resolve, reject) => {
          writer.on('finish', () => resolve(true));
          writer.on('error', reject);
        });
        
        logger.info('Download complete. Extracting...');
        await execAsync(`tar -xzf ${updatePath} --strip-components=1 -C ${__dirname}`);
        
        logger.info('Extraction complete. Installing dependencies...');
        await execAsync(`cd ${__dirname} && npm install`);
        
        logger.info('Dependencies installed. Building frontend...');
        await execAsync(`cd ${__dirname} && npm run build`);
        
        logger.info('Build complete. Cleaning up...');
        if (fs.existsSync(updatePath)) {
          fs.unlinkSync(updatePath);
        }
        
        logger.info('Update finished successfully. Restarting server...');
        process.exit(0); // Docker will restart the container
      } catch (err: any) {
        logger.error(`Background update failed: ${err.message}`);
      }
    }, 1000);
    
  } catch (e: any) {
    logger.error(`Update failed: ${e.message}`);
    res.status(500).json({ error: `更新触发失败: ${e.message}` });
  }
});

// Setup Wizard API
app.get('/api/system/status', (req, res) => {
  const isInitialized = !!getSetting('aliyun_api_key');
  res.json({ initialized: isInitialized });
});

app.post('/api/system/setup', (req, res) => {
  const isInitialized = !!getSetting('aliyun_api_key');
  if (isInitialized) return res.status(403).json({ error: '系统已初始化，禁止重复设置' });

  const { adminPassword, ...settings } = req.body;
  
  // Update admin password
  if (adminPassword) {
    const adminUser = db.prepare("SELECT * FROM users WHERE username = 'admin'").get() as any;
    if (adminUser) {
      const newSalt = crypto.randomBytes(16).toString('hex');
      const newHash = hashPassword(adminPassword, newSalt);
      db.prepare('UPDATE users SET password_hash = ?, salt = ?, must_change_password = 0 WHERE username = ?').run(newHash, newSalt, 'admin');
    }
  }

  // Save settings
  for (const [key, value] of Object.entries(settings)) {
    setSetting(key, value as string);
  }

  logger.info('System initialized via Setup Wizard.');
  res.json({ success: true });
});

// Test API Connections
app.post('/api/test/llm', async (req, res) => {
  const { aliyun_api_key, llm_base_url, model_planner, http_proxy } = req.body;
  const diagnostics: any[] = [];
  
  try {
    const url = new URL(llm_base_url || 'https://dashscope.aliyuncs.com/compatible-mode/v1');
    diagnostics.push(`Testing connectivity to: ${url.hostname}`);
    
    // DNS Test
    try {
      const dns = await import('dns/promises');
      const lookup = await dns.lookup(url.hostname);
      diagnostics.push(`DNS OK: Resolved to ${lookup.address}`);
    } catch (dnsErr: any) {
      diagnostics.push(`DNS FAILED: ${dnsErr.message}`);
      
      // 增加 IP 连通性测试
      diagnostics.push(`正在尝试 IP 直连测试...`);
      try {
        const { execSync } = await import('child_process');
        // 测试阿里 DNS IP
        execSync('ping -c 1 -W 2 223.5.5.5');
        diagnostics.push(`IP TEST OK: 成功连接到公共 DNS (223.5.5.5)，说明仅 DNS 解析失效。`);
      } catch (pingErr) {
        diagnostics.push(`IP TEST FAILED: 无法连接到外网 IP (223.5.5.5)，说明容器完全断网。`);
      }
      
      diagnostics.push(`建议: 请在 docker-compose 中设置 network_mode: "host" 或手动指定 dns: [223.5.5.5]`);
    }

    const options: any = { 
      apiKey: aliyun_api_key, 
      baseURL: llm_base_url || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      timeout: 30000,
      maxRetries: 0
    };

    if (http_proxy) {
      diagnostics.push(`Using proxy: ${http_proxy}`);
      const agent = getProxyAgent(http_proxy);
      options.httpAgent = agent;
      options.httpsAgent = agent;
    } else {
      diagnostics.push('No proxy configured in app settings.');
    }

    const client = new OpenAI(options);
    const response = await client.chat.completions.create({
      model: model_planner || 'qwen-plus',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 5
    });
    
    res.json({ 
      success: true, 
      message: 'LLM 连接成功！',
      diagnostics 
    });
  } catch (e: any) {
    logger.error(`LLM Test Error: ${e.message} - ${e.stack}`);
    let errorMsg = e.message;
    if (e.code === 'ECONNREFUSED') errorMsg = '连接被拒绝。请检查 API 地址或代理设置是否正确。';
    if (e.code === 'ETIMEDOUT') errorMsg = '连接超时。请检查网络或代理是否可用。';
    if (e.code === 'ENOTFOUND') errorMsg = '无法解析域名。请检查 NAS 的 DNS 设置。';
    if (e.message.includes('401')) errorMsg = 'API Key 无效 (401 Unauthorized)。';
    
    res.status(400).json({ 
      error: `LLM 连接失败: ${errorMsg}`,
      details: e.message,
      code: e.code,
      diagnostics
    });
  }
});

app.post('/api/test/search', async (req, res) => {
  const { bocha_api_key, http_proxy } = req.body;
  const diagnostics: any[] = [];
  
  try {
    const hostname = 'api.bochaai.com';
    diagnostics.push(`Testing connectivity to: ${hostname}`);
    
    // DNS Test
    try {
      const dns = await import('dns/promises');
      const addresses = await dns.resolve(hostname);
      diagnostics.push(`DNS OK: ${addresses.join(', ')}`);
    } catch (dnsErr: any) {
      diagnostics.push(`DNS FAILED: ${dnsErr.message}`);
    }

    const axiosConfig: any = { 
      headers: { 'Authorization': `Bearer ${bocha_api_key}`, 'Content-Type': 'application/json' },
      timeout: 20000,
      family: 4 
    };

    if (http_proxy) {
      diagnostics.push(`Using proxy: ${http_proxy}`);
      const agent = getProxyAgent(http_proxy);
      axiosConfig.httpsAgent = agent;
      axiosConfig.httpAgent = agent;
      axiosConfig.proxy = false;
    } else {
      diagnostics.push('No proxy configured in app settings.');
    }

    const response = await axios.post(
      'https://api.bochaai.com/v1/web-search',
      { query: 'test', count: 1 },
      axiosConfig
    );
    if (response.data?.code === 200 || response.data?.data) {
      res.json({ success: true, message: '检索服务连接成功！', diagnostics });
    } else {
      res.status(400).json({ error: `检索服务连接失败: ${JSON.stringify(response.data)}`, diagnostics });
    }
  } catch (e: any) {
    logger.error(`Search Test Error: ${e.message}`);
    res.status(400).json({ error: `检索服务连接失败: ${e.message}`, diagnostics });
  }
});

app.post('/api/test/push', async (req, res) => {
  const { tg_bot_token, tg_chat_id, feishu_app_id, feishu_app_secret, http_proxy } = req.body;
  let successMsg = '';
  let errorMsg = '';
  
  if (tg_bot_token && tg_chat_id) {
    const axiosConfig: any = { family: 4 };
    if (http_proxy) {
      const agent = getProxyAgent(http_proxy);
      axiosConfig.httpsAgent = agent;
      axiosConfig.httpAgent = agent;
    }
    try {
      await axios.post(`https://api.telegram.org/bot${tg_bot_token}/sendMessage`, { chat_id: tg_chat_id, text: '测试消息：系统推送配置成功！' }, axiosConfig);
      successMsg += 'Telegram 推送成功！';
    } catch (e: any) {
      errorMsg += `Telegram 失败: ${e.message} `;
    }
  }
  
  if (feishu_app_id && feishu_app_secret) {
    try {
      // 1. 获取 tenant_access_token
      const tokenRes = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        app_id: feishu_app_id,
        app_secret: feishu_app_secret
      });
      const token = tokenRes.data.tenant_access_token;
      if (!token) throw new Error('获取飞书 Token 失败');

      // 2. 测试创建一个空文档
      const createRes = await axios.post('https://open.feishu.cn/open-apis/docx/v1/documents', {
        title: "Deep Research 测试文档"
      }, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (createRes.data.code === 0) {
        successMsg += '飞书文档集成成功！';
      } else {
        throw new Error(createRes.data.msg || '创建文档失败');
      }
    } catch (e: any) {
      errorMsg += `飞书失败: ${e.message}`;
    }
  }
  
  if (errorMsg && !successMsg) {
    res.status(400).json({ error: errorMsg });
  } else if (errorMsg && successMsg) {
    res.json({ success: true, message: successMsg, error: errorMsg, partial: true });
  } else if (successMsg) {
    res.json({ success: true, message: successMsg });
  } else {
    res.status(400).json({ error: '未配置任何推送服务' });
  }
});

app.post('/api/system/reset', authenticateToken, requireAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM settings').run();
    db.prepare('DELETE FROM users').run();
    logger.info('System reset by admin.');
    res.json({ success: true, message: '系统已重置，请刷新页面重新配置。' });
  } catch (e: any) {
    res.status(500).json({ error: `重置失败: ${e.message}` });
  }
});

// Logs API
app.get('/api/logs', authenticateToken, requireAdmin, (req, res) => {
  try {
    const logDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logDir)) return res.json([]);
    const files = fs.readdirSync(logDir).filter(f => f.endsWith('.log'));
    const logs = files.map(f => {
      const stats = fs.statSync(path.join(logDir, f));
      return { filename: f, size: stats.size, createdAt: stats.birthtime };
    }).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    res.json(logs);
  } catch (e) {
    res.json([]);
  }
});

app.get('/api/logs/:filename', authenticateToken, requireAdmin, (req, res) => {
  const filepath = path.join(__dirname, 'logs', req.params.filename);
  if (fs.existsSync(filepath)) {
    res.download(filepath);
  } else {
    res.status(404).send('File not found');
  }
});

app.delete('/api/logs', authenticateToken, requireAdmin, (req, res) => {
  try {
    const logDir = path.join(__dirname, 'logs');
    if (fs.existsSync(logDir)) {
      const files = fs.readdirSync(logDir).filter(f => f.endsWith('.log'));
      files.forEach(f => fs.unlinkSync(path.join(logDir, f)));
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Auth API
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const ip = req.ip || req.socket.remoteAddress || 'unknown';

  try {
    checkRateLimit(ip);
  } catch (e: any) {
    return res.status(429).json({ error: e.message });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
  if (!user) {
    recordFailedLogin(ip);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const hash = hashPassword(password, user.salt);
  if (hash !== user.password_hash) {
    recordFailedLogin(ip);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  resetLoginAttempts(ip);
  logger.info(`User ${username} logged in successfully from ${ip}`);

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, mustChangePassword: user.must_change_password === 1 },
    jwtSecret,
    { expiresIn: '7d' }
  );

  res.json({ token, user: { id: user.id, username: user.username, role: user.role, quota: user.quota, daily_limit: user.daily_limit, total_quota: user.total_quota, used_quota: user.used_quota, daily_used: user.daily_used, mustChangePassword: user.must_change_password === 1 } });
});

app.post('/api/auth/change-password', authenticateToken, (req: any, res: any) => {
  const { oldPassword, newPassword } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id) as any;
  
  const oldHash = hashPassword(oldPassword, user.salt);
  if (oldHash !== user.password_hash) {
    return res.status(400).json({ error: '旧密码错误' });
  }

  const newSalt = crypto.randomBytes(16).toString('hex');
  const newHash = hashPassword(newPassword, newSalt);

  db.prepare('UPDATE users SET password_hash = ?, salt = ?, must_change_password = 0 WHERE id = ?')
    .run(newHash, newSalt, user.id);
  
  logger.info(`User ${user.username} changed their password.`);
  res.json({ success: true });
});

// User Management API (Admin Only)
app.get('/api/users', authenticateToken, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, role, quota, daily_limit, total_quota, used_quota, daily_used, created_at FROM users').all();
  res.json(users);
});

app.post('/api/users', authenticateToken, requireAdmin, (req, res) => {
  const { username, password, role, quota, daily_limit, total_quota } = req.body;
  try {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);
    const dl = daily_limit !== undefined ? daily_limit : 3;
    const tq = total_quota !== undefined ? total_quota : 10;
    const q = quota !== undefined ? quota : tq;
    db.prepare('INSERT INTO users (id, username, password_hash, salt, role, must_change_password, quota, daily_limit, total_quota, used_quota, daily_used) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), username, hash, salt, role || 'user', 0, q, dl, tq, 0, 0);
    logger.info(`Admin created new user: ${username}`);
    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ error: 'Username may already exist' });
  }
});

app.put('/api/users/:id/quota', authenticateToken, requireAdmin, (req: any, res: any) => {
  const { quota, daily_limit, total_quota } = req.body;
  if (typeof quota !== 'number') return res.status(400).json({ error: 'Invalid quota' });
  const dl = daily_limit !== undefined ? daily_limit : 3;
  const tq = total_quota !== undefined ? total_quota : 10;
  
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  // If total_quota changed but quota didn't (meaning the admin only updated total_quota in the UI)
  let newQuota = quota;
  if (quota === user.quota && tq !== user.total_quota) {
    const diff = tq - user.total_quota;
    newQuota = user.quota + diff;
  }
  
  db.prepare('UPDATE users SET quota = ?, daily_limit = ?, total_quota = ? WHERE id = ?').run(newQuota, dl, tq, req.params.id);
  logger.info(`Admin updated quota for user ${req.params.id} to quota=${newQuota}, daily_limit=${dl}, total_quota=${tq}`);
  res.json({ success: true });
});

app.put('/api/users/:id/password', authenticateToken, requireAdmin, (req: any, res: any) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: '密码长度至少为 6 位' });
  }
  const newSalt = crypto.randomBytes(16).toString('hex');
  const newHash = hashPassword(newPassword, newSalt);
  db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').run(newHash, newSalt, req.params.id);
  logger.info(`Admin changed password for user ${req.params.id}`);
  res.json({ success: true });
});

app.delete('/api/users/:id', authenticateToken, requireAdmin, (req: any, res: any) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  logger.info(`Admin deleted user: ${req.params.id}`);
  res.json({ success: true });
});

// Settings API
app.get('/api/settings', authenticateToken, requireAdmin, (req, res) => {
  const keys = ['aliyun_api_key', 'llm_base_url', 'model_planner', 'model_writer', 'bocha_api_key', 'tg_bot_token', 'tg_chat_id', 'feishu_app_id', 'feishu_app_secret', 'http_proxy'];
  const settings: Record<string, string> = {};
  keys.forEach(k => settings[k] = getSetting(k));
  res.json(settings);
});

app.post('/api/settings', authenticateToken, requireAdmin, (req, res) => {
  const settings = req.body;
  for (const [key, value] of Object.entries(settings)) {
    setSetting(key, value as string);
  }
  logger.info(`Admin updated settings.`);
  res.json({ success: true });
});

// Task API
app.post('/api/research', authenticateToken, (req, res) => {
  try {
    const { topic, length } = req.body;
    if (!topic) return res.status(400).json({ error: 'Topic is required' });

    const taskId = Date.now().toString();
    const user = (req as any).user.username;
    
    const today = new Date().toISOString().split('T')[0];
    const userData = db.prepare('SELECT quota, daily_limit, total_quota, used_quota, daily_used, last_reset_date FROM users WHERE username = ?').get(user) as any;
    
    if (userData) {
      if (userData.last_reset_date !== today) {
        userData.daily_used = 0;
        db.prepare('UPDATE users SET daily_used = 0, last_reset_date = ? WHERE username = ?').run(today, user);
      }

      if (userData.quota <= 0) {
        return res.status(403).json({ error: '您的报告生成总额度已用完，请联系管理员充值。' });
      }

      if (userData.daily_used >= userData.daily_limit) {
        return res.status(403).json({ error: '您今日的生成额度已达上限，请明天再来。' });
      }
    }
    
    if (currentRunningTask) {
      return res.status(409).json({ 
        error: `系统繁忙：正在为 ${currentRunningTask.username} 生成《${currentRunningTask.topic}》报告。请耐心等待，做完他的，再做你的。` 
      });
    }

    db.prepare('INSERT INTO tasks (id, topic, status) VALUES (?, ?, ?)').run(taskId, topic, 'running');
    db.prepare('UPDATE users SET quota = quota - 1, used_quota = used_quota + 1, daily_used = daily_used + 1 WHERE username = ?').run(user);
    
    logger.info(`User ${user} started research task: ${topic}`);
    runDeepResearch(taskId, topic, length, user);
    
    res.json({ taskId, message: 'Task started successfully' });
  } catch (e: any) {
    logger.error(`Error starting research task: ${e.message}`);
    res.status(500).json({ error: `启动任务失败: ${e.message}` });
  }
});

// Reports API
app.get('/api/reports', authenticateToken, (req, res) => {
  try {
    const reports = db.prepare('SELECT * FROM reports ORDER BY created_at DESC').all();
    res.json(reports);
  } catch (e) {
    logger.error(`Error reading reports from DB: ${e}`);
    res.json([]);
  }
});

app.get('/api/reports/:id/view', (req, res) => {
  try {
    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id) as any;
    if (report && report.md_path && fs.existsSync(report.md_path)) {
      let markdown = fs.readFileSync(report.md_path, 'utf8');
      
      // Fix malformed headings in the markdown file itself
      const originalMarkdown = markdown;
      markdown = markdown.replace(/^ {0,3}(#{1,6})\s+#{1,6}\s+/gm, '$1 ');
      markdown = markdown.replace(/^ {0,3}(#{1,6})([^#\s])/gm, '$1 $2');
      markdown = markdown.replace(/^ {0,3}\*\*(#{1,6})\s+(.*?)\*\*/gm, '$1 **$2**');
      
      if (markdown !== originalMarkdown) {
        fs.writeFileSync(report.md_path, markdown);
      }
      
      const htmlContent = generateHtmlReport(report.title, markdown, report.feishu_url, report.created_at);
      res.setHeader('Content-Type', 'text/html');
      res.send(htmlContent);
      
      if (report.html_path) {
        fs.writeFileSync(report.html_path, htmlContent);
      }
    } else if (report && report.html_path && fs.existsSync(report.html_path)) {
      res.setHeader('Content-Type', 'text/html');
      res.send(fs.readFileSync(report.html_path, 'utf8'));
    } else {
      res.status(404).send('Report not found');
    }
  } catch (e) {
    res.status(500).send('Error loading report');
  }
});

app.get('/api/reports/:id/download', (req, res) => {
  try {
    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id) as any;
    if (report && report.md_path && fs.existsSync(report.md_path)) {
      let markdown = fs.readFileSync(report.md_path, 'utf8');
      
      // Fix malformed headings in the markdown file itself
      const originalMarkdown = markdown;
      markdown = markdown.replace(/^ {0,3}(#{1,6})\s+#{1,6}\s+/gm, '$1 ');
      markdown = markdown.replace(/^ {0,3}(#{1,6})([^#\s])/gm, '$1 $2');
      markdown = markdown.replace(/^ {0,3}\*\*(#{1,6})\s+(.*?)\*\*/gm, '$1 **$2**');
      
      if (markdown !== originalMarkdown) {
        fs.writeFileSync(report.md_path, markdown);
      }
      
      const htmlContent = generateHtmlReport(report.title, markdown, report.feishu_url, report.created_at);
      if (report.html_path) {
        fs.writeFileSync(report.html_path, htmlContent);
      }
      res.download(report.html_path, `${report.title}.html`);
    } else if (report && report.html_path && fs.existsSync(report.html_path)) {
      res.download(report.html_path, `${report.title}.html`);
    } else {
      res.status(404).send('Report not found');
    }
  } catch (e) {
    res.status(500).send('Error downloading report');
  }
});

app.get('/api/reports/:id/md', authenticateToken, (req, res) => {
  try {
    const report = db.prepare('SELECT md_path, title FROM reports WHERE id = ?').get(req.params.id) as any;
    if (report && report.md_path && fs.existsSync(report.md_path)) {
      let markdown = fs.readFileSync(report.md_path, 'utf8');
      
      // Fix malformed headings in the markdown file itself
      const originalMarkdown = markdown;
      markdown = markdown.replace(/^ {0,3}(#{1,6})\s+#{1,6}\s+/gm, '$1 ');
      markdown = markdown.replace(/^ {0,3}(#{1,6})([^#\s])/gm, '$1 $2');
      markdown = markdown.replace(/^ {0,3}\*\*(#{1,6})\s+(.*?)\*\*/gm, '$1 **$2**');
      
      if (markdown !== originalMarkdown) {
        fs.writeFileSync(report.md_path, markdown);
      }
      
      res.download(report.md_path, `${report.title}.md`);
    } else {
      res.status(404).send('Report not found');
    }
  } catch (e) {
    res.status(500).send('Error downloading report');
  }
});

app.delete('/api/reports/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const report = db.prepare('SELECT html_path, md_path FROM reports WHERE id = ?').get(req.params.id) as any;
    if (report) {
      if (report.html_path && fs.existsSync(report.html_path)) fs.unlinkSync(report.html_path);
      if (report.md_path && fs.existsSync(report.md_path)) fs.unlinkSync(report.md_path);
      db.prepare('DELETE FROM reports WHERE id = ?').run(req.params.id);
      logger.info(`Admin deleted report: ${req.params.id}`);
      res.json({ success: true });
    } else {
      res.status(404).send('Report not found');
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// SSE Endpoint (Auth via query param)
app.get('/api/system-status/stream', (req, res) => {
  const token = req.query.token as string;
  try {
    jwt.verify(token, jwtSecret);
  } catch (e) {
    return res.status(401).send('Unauthorized');
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const onStatus = (data: string) => res.write(`data: ${data}\n\n`);
  
  // Send initial status
  res.write(`data: ${JSON.stringify({
    type: 'system_status',
    data: { isBusy: currentRunningTask !== null, currentTask: currentRunningTask }
  })}\n\n`);

  taskEvents.on('system_status', onStatus);

  req.on('close', () => {
    taskEvents.off('system_status', onStatus);
  });
});

app.get('/api/research/:id/stream', (req, res) => {
  const token = req.query.token as string;
  try {
    jwt.verify(token, jwtSecret);
  } catch (e) {
    return res.status(401).send('Unauthorized');
  }

  const taskId = req.params.id;
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const onLog = (data: string) => res.write(`data: ${data}\n\n`);
  const onDone = (data: string = "{}") => res.write(`event: done\ndata: ${data}\n\n`);

  taskEvents.on(`log-${taskId}`, onLog);
  taskEvents.on(`done-${taskId}`, onDone);

  // SSE 心跳保活机制 (Heartbeat) - 防止反向代理 (如 Nginx) 超时断开连接
  const heartbeatInterval = setInterval(() => {
    res.write(':\n\n'); // 发送空注释作为心跳包
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeatInterval);
    taskEvents.off(`log-${taskId}`, onLog);
    taskEvents.off(`done-${taskId}`, onDone);
  });
});

// Chat API (for outline generation)
app.post('/api/chat', authenticateToken, async (req, res) => {
  try {
    const client = getLLMClient();
    const response = await client.chat.completions.create({
      model: getSetting('model_planner', 'qwen-plus'),
      messages: req.body.messages,
    });
    res.json({ reply: response.choices[0].message.content });
  } catch (e: any) {
    logger.error(`Chat API Error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/generate-outline', authenticateToken, async (req, res) => {
  try {
    const { topic, length } = req.body;
    const client = getLLMClient();
    const prompt = `你是一个只输出 JSON 的数据转换接口。请根据用户探讨的课题：【${topic}】，生成一份深度研究报告大纲。预期篇幅：${length}字。
必须严格遵守以下 JSON 结构：
{
  "report_title": "报告主标题",
  "chapters": [
    {
      "chapter_num": 1,
      "chapter_title": "第一章：...",
      "core_points": "本章需要探讨的核心论点..."
    }
  ]
}`;
    const response = await client.chat.completions.create({
      model: getSetting('model_planner', 'qwen-plus'),
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    });
    let rawJson = response.choices[0].message.content || '';
    rawJson = rawJson.replace(/```json/g, '').replace(/```/g, '').trim();
    res.json(JSON.parse(rawJson));
  } catch (e: any) {
    logger.error(`Outline Gen Error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// ==========================================
// 7. Server Startup
// ==========================================
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
  }

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
