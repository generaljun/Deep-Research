import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import OpenAI from 'openai';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Logging Setup (with rotation)
// ==========================================
export const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const getLogFile = () => path.join(logDir, `app-${new Date().toISOString().split('T')[0]}.log`);

export const logger = {
  info: (msg: string) => appendLog('INFO', msg),
  warn: (msg: string) => appendLog('WARN', msg),
  error: (msg: string) => appendLog('ERROR', msg),
};

export function appendLog(level: string, msg: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${msg}\n`;
  console.log(line.trim());
  fs.appendFileSync(getLogFile(), line);
}

export function appendTaskLog(taskId: string, level: string, msg: string) {
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
export let db: Database.Database;
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

    const taskColumns = db.prepare("PRAGMA table_info(tasks)").all() as any[];
    const taskColNames = taskColumns.map(c => c.name);
    if (!taskColNames.includes('current_chapter_index')) {
      db.exec("ALTER TABLE tasks ADD COLUMN current_chapter_index INTEGER DEFAULT 0");
      console.log("Migration: Added current_chapter_index column to tasks table");
    }
    if (!taskColNames.includes('chapter_states')) {
      db.exec("ALTER TABLE tasks ADD COLUMN chapter_states TEXT");
      console.log("Migration: Added chapter_states column to tasks table");
    }
    if (!taskColNames.includes('outline')) {
      db.exec("ALTER TABLE tasks ADD COLUMN outline TEXT");
      console.log("Migration: Added outline column to tasks table");
    }
    if (!taskColNames.includes('length')) {
      db.exec("ALTER TABLE tasks ADD COLUMN length TEXT");
      console.log("Migration: Added length column to tasks table");
    }
    if (!taskColNames.includes('user')) {
      db.exec("ALTER TABLE tasks ADD COLUMN user TEXT");
      console.log("Migration: Added user column to tasks table");
    }
    if (!taskColNames.includes('feishu_doc_id')) {
      db.exec("ALTER TABLE tasks ADD COLUMN feishu_doc_id TEXT");
      console.log("Migration: Added feishu_doc_id column to tasks table");
    }
    if (!taskColNames.includes('file_path')) {
      db.exec("ALTER TABLE tasks ADD COLUMN file_path TEXT");
      console.log("Migration: Added file_path column to tasks table");
    }
    if (!taskColNames.includes('file_paths')) {
      db.exec("ALTER TABLE tasks ADD COLUMN file_paths TEXT");
      console.log("Migration: Added file_paths column to tasks table");
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

export const getSetting = (key: string, defaultValue = '') => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
  return (row && row.value) ? row.value : defaultValue;
};

export const setSetting = (key: string, value: string) => {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
};

// ==========================================
// 3. Auth & Security Helpers
// ==========================================
export let jwtSecret = getSetting('jwt_secret');
if (!jwtSecret) {
  jwtSecret = crypto.randomBytes(32).toString('hex');
  setSetting('jwt_secret', jwtSecret);
  logger.info('Generated new JWT secret');
} else {
  logger.info('Loaded existing JWT secret');
}

export const hashPassword = (password: string, salt: string) => {
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

export const checkRateLimit = (ip: string) => {
  const record = db.prepare('SELECT * FROM login_attempts WHERE ip = ?').get(ip) as any;
  if (record && record.lock_until) {
    if (new Date(record.lock_until) > new Date()) {
      const minutesLeft = Math.ceil((new Date(record.lock_until).getTime() - Date.now()) / 60000);
      throw new Error(`IP 已被锁定，请在 ${minutesLeft} 分钟后重试。`);
    }
  }
};

export const recordFailedLogin = (ip: string) => {
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

export const resetLoginAttempts = (ip: string) => {
  db.prepare('DELETE FROM login_attempts WHERE ip = ?').run(ip);
};

// Middleware
export const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];
  
  // Also check query parameter (useful for direct file downloads via <a> tags)
  if (!token && req.query.token) {
    token = req.query.token as string;
  }

  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  jwt.verify(token, jwtSecret, (err: any, user: any) => {
    if (err) return res.status(401).json({ error: 'Token expired or invalid' });
    req.user = user;
    next();
  });
};

export const requireAdmin = (req: any, res: any, next: any) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
};

// ==========================================
// 4. SSE & Helper Functions
// ==========================================
export const taskEvents = new EventEmitter();

export let currentRunningTask: { taskId: string, username: string, topic: string } | null = null;

export const broadcastSystemStatus = () => {
  const status = JSON.stringify({
    type: 'system_status',
    data: { isBusy: currentRunningTask !== null, currentTask: currentRunningTask }
  });
  taskEvents.emit('system_status', status);
};

export const broadcastLog = (taskId: string, message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
  const logEntry = JSON.stringify({ timestamp: new Date().toISOString(), message, type });
  taskEvents.emit(`log-${taskId}`, logEntry);
  logger.info(`[Task ${taskId}] ${message}`);
  appendTaskLog(taskId, type.toUpperCase(), message);
};

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const withRetry = async <T>(fn: () => Promise<T>, retries = 3, delay = 2000, broadcastLog?: any, taskId?: string): Promise<T> => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      if (i === retries - 1) throw error;
      const msg = `[Retry ${i + 1}/${retries}] API Error: ${error.message}. Retrying in ${delay}ms...`;
      logger.warn(msg);
      if (broadcastLog && taskId) {
        broadcastLog(taskId, `⏳ API 调用失败，正在进行第 ${i + 1} 次重试... (${error.message})`, 'warning');
      }
      await sleep(delay);
      delay *= 2;
    }
  }
  throw new Error('Unreachable');
};

export const streamLLMWithProgress = async (
  client: any,
  model: string,
  messages: any[],
  temperature: number,
  taskId: string,
  broadcastLog: any,
  progressPrefix: string,
  retries = 3,
  delay = 2000
): Promise<string> => {
  return await withRetry(async () => {
    const stream = await client.chat.completions.create({
      model,
      messages,
      temperature,
      stream: true,
    });

    let fullContent = '';
    let lastLogTime = Date.now();
    let charCount = 0;
    let recentText = '';

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || '';
      fullContent += text;
      charCount += text.length;
      recentText += text;
      
      if (Date.now() - lastLogTime > 5000) { // Log every 5 seconds
        const snippet = recentText.replace(/\n/g, ' ').slice(-30).trim();
        broadcastLog(taskId, `⏳ ${progressPrefix} (已生成 ${charCount} 字) ...${snippet}`, 'info');
        lastLogTime = Date.now();
        recentText = ''; // reset recent text after logging
      }
    }
    return fullContent;
  }, retries, delay, broadcastLog, taskId);
};

export const getProxyAgent = (proxyUrl: string) => {
  if (!proxyUrl) return undefined;
  if (proxyUrl.startsWith('socks')) {
    return new SocksProxyAgent(proxyUrl);
  }
  return new HttpsProxyAgent(proxyUrl);
};

export const getLLMClient = (agentType?: string) => {
  let apiKey = getSetting('aliyun_api_key');
  let baseURL = getSetting('llm_base_url', 'https://dashscope.aliyuncs.com/compatible-mode/v1');

  if (agentType) {
    const overrideKey = getSetting(`${agentType}_api_key`);
    const overrideBaseUrl = getSetting(`${agentType}_base_url`);
    if (overrideKey) apiKey = overrideKey;
    if (overrideBaseUrl) baseURL = overrideBaseUrl;
  }
  
  const proxyUrl = getSetting('http_proxy');
  
  if (!apiKey) throw new Error(`未配置大模型 API Key (${agentType || '全局'})，请前往后台设置。`);
  
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

// ==========================================
export function setCurrentRunningTask(task: { taskId: string, username: string, topic: string } | null) { currentRunningTask = task; }
