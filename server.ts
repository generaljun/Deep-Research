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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS login_attempts (
      ip TEXT PRIMARY KEY,
      attempts INTEGER DEFAULT 0,
      tier INTEGER DEFAULT 0,
      lock_until DATETIME
    );
  `);
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
    
    const plannerPrompt = `你是一个只输出 JSON 的数据转换接口。请根据用户探讨的课题：【${topic}】，生成一份深度研究报告大纲。
预期篇幅：${length}字。必须融入行业特性。
【致命约束】
1. 绝对禁止输出任何 Markdown 标记（如 \`\`\`json）、禁止输出任何问候语或解释。
2. 必须严格遵守以下 JSON 结构：
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
    const timeStr = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
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

    for (let i = 0; i < outline.chapters.length; i++) {
      const chapter = outline.chapters[i];
      runningTask.progress = 10 + Math.floor((i / outline.chapters.length) * 80);
      broadcastLog(taskId, `🔍 开始处理：${chapter.chapter_title}`);
      
      let searchResults = '';
      try {
        broadcastLog(taskId, `🌐 正在调用博查 API 检索素材...`);
        searchResults = await withRetry(() => searchBocha(`${chapter.chapter_title} ${chapter.core_points}`));
        broadcastLog(taskId, `✅ 检索完成，获取到有效参考素材。`, 'success');
      } catch (e: any) {
        const errCode = e.response?.status || e.code || 'UNKNOWN';
        broadcastLog(taskId, `⚠️ [检索模块] 检索失败，将基于大模型自身知识撰写。错误代码: ${errCode}, 原因: ${e.message}`, 'warning');
        searchResults = '检索失败，请基于大模型自身知识撰写。';
      }

      try {
        broadcastLog(taskId, `✍️ 正在调用撰稿人 (${modelWriter}) 撰写本章正文...`);
        const writerPrompt = `你是一位顶级的行业资深撰稿人。请根据【章节标题】以及提供的【参考素材】，撰写本章的正文内容。
【行文要求】
1. 深度剖析：不要只做数据的堆砌，必须对数据背后的商业逻辑、技术瓶颈进行深度推演。
2. 格式要求：必须使用标准的 Markdown 格式排版。为了让报告输出可视化效果更好，请务必在正文中包含至少一个高质量的 Markdown 可视化数据表格，并合理使用二级/三级标题、加粗、引用块等元素增强排版美感。
3. 严禁废话：直接输出正文，绝对不要输出“好的”、“以下是为您撰写的内容”等废话。
4. 严谨性：数据和事实必须严格依据【参考素材】，不得产生幻觉。
5. 数据溯源标注：报告中引用的数据和结论，必须在句末使用小标（如：[^1]、[^2]）进行标注。
6. 参考文献列表：必须在本章正文的最后，单独设立一个“### 本章参考数据源”小节，将正文中用到的小标对应的来源统一列出，格式必须包含标题和完整的URL，例如：
   [^1]: [来源文章标题](URL)
   让用户可以直接点击打开去深度挖掘。

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
        if (!content.includes(chapter.chapter_title)) {
          finalContent = `## ${chapter.chapter_title}\n\n${content}`;
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
    if (feishuDocId) {
      broadcastLog(taskId, `📄 飞书文档已同步完成：https://bytedance.feishu.cn/docx/${feishuDocId}`, 'success');
    }
    db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('completed', taskId);
    
    const feishuLink = feishuDocId ? `\n飞书文档：https://bytedance.feishu.cn/docx/${feishuDocId}` : '';
    await sendNotifications(`🎉 深度研究报告生成完毕！\n课题：${topic}${feishuLink}\n请前往 NAS 目录查看：${filePath}`);
    taskEvents.emit(`done-${taskId}`);

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

  res.json({ token, user: { id: user.id, username: user.username, role: user.role, mustChangePassword: user.must_change_password === 1 } });
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
  const users = db.prepare('SELECT id, username, role, created_at FROM users').all();
  res.json(users);
});

app.post('/api/users', authenticateToken, requireAdmin, (req, res) => {
  const { username, password, role } = req.body;
  try {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);
    db.prepare('INSERT INTO users (id, username, password_hash, salt, role, must_change_password) VALUES (?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), username, hash, salt, role || 'user', 0);
    logger.info(`Admin created new user: ${username}`);
    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ error: 'Username may already exist' });
  }
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
    
    if (currentRunningTask) {
      return res.status(409).json({ 
        error: `系统繁忙：正在为 ${currentRunningTask.username} 生成《${currentRunningTask.topic}》报告。请耐心等待，做完他的，再做你的。` 
      });
    }

    db.prepare('INSERT INTO tasks (id, topic, status) VALUES (?, ?, ?)').run(taskId, topic, 'running');
    
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
    const reportsDir = path.join(__dirname, 'reports');
    if (!fs.existsSync(reportsDir)) return res.json([]);
    
    const files = fs.readdirSync(reportsDir).filter(f => f.endsWith('.md'));
    const reports = files.map(f => {
      const stats = fs.statSync(path.join(reportsDir, f));
      
      // 尝试从文件名解析时间 (格式: 用户名-报告名-YYYYMMDD_HHMMSS.md)
      let createdAt = stats.mtime;
      const timeMatch = f.match(/-(\d{8}_\d{6})\.md$/);
      if (timeMatch) {
        const t = timeMatch[1];
        const year = parseInt(t.substring(0, 4));
        const month = parseInt(t.substring(4, 6)) - 1;
        const day = parseInt(t.substring(6, 8));
        const hour = parseInt(t.substring(9, 11));
        const minute = parseInt(t.substring(11, 13));
        const second = parseInt(t.substring(13, 15));
        createdAt = new Date(year, month, day, hour, minute, second);
      }
      
      return { filename: f, size: stats.size, createdAt };
    }).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    res.json(reports);
  } catch (e) {
    logger.error(`Error reading reports: ${e}`);
    res.json([]);
  }
});

app.get('/api/reports/:filename', authenticateToken, (req, res) => {
  const filepath = path.join(__dirname, 'reports', req.params.filename);
  if (fs.existsSync(filepath)) {
    res.download(filepath);
  } else {
    res.status(404).send('File not found');
  }
});

app.delete('/api/reports/:filename', authenticateToken, requireAdmin, (req, res) => {
  const filepath = path.join(__dirname, 'reports', req.params.filename);
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
    logger.info(`Admin deleted report: ${req.params.filename}`);
    res.json({ success: true });
  } else {
    res.status(404).send('File not found');
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
  const onDone = () => res.write(`event: done\ndata: {}\n\n`);

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
