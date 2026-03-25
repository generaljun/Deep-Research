import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import OpenAI from 'openai';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const multer = require('multer');
import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import crypto from 'crypto';

const execAsync = promisify(exec);

console.log('------------------------------------------------');
console.log(`🚀 Server starting...`);
console.log(`💻 System: ${os.platform()} (${os.arch()})`);
console.log(`📦 Node: ${process.version}`);
console.log('------------------------------------------------');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir)
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, uniqueSuffix + '-' + file.originalname)
  }
})
const upload = multer({ storage: storage });

const app = express();
app.set('trust proxy', true); // Trust all proxies in NAS/Proxy environments
const PORT = Number(process.env.PORT) || 3000;

app.use(cors({
  origin: (origin, callback) => {
    // Allow all origins, especially useful for NAS with dynamic IPs/domains
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
}));
app.use(express.json());

// ==========================================
import { 
  logger, getSetting, setSetting, db, taskEvents, withRetry, appendLog, appendTaskLog,
  getLLMClient, getProxyAgent, sleep,   authenticateToken, requireAdmin, hashPassword, checkRateLimit,
  recordFailedLogin, resetLoginAttempts, broadcastSystemStatus, broadcastLog, 
  currentRunningTask, setCurrentRunningTask, jwtSecret, streamLLMWithProgress
} from './utils.js';
import { buildKnowledgeBase, queryKnowledgeBase, buildSupplementalKnowledgeBase, DocumentChunk, searchBocha, createFeishuDoc, appendToFeishuDoc, generateHtmlReport, sendNotifications } from './rag.js';
// 5. Core Deep Research Engine & Queue
// ==========================================
let runningTask: { id: string, topic: string, user: string, progress: number, status: string } | null = null;
let taskQueue: { id: string, topic: string, user: string, length?: string, outline?: any, filePaths?: string[] }[] = [];

const getLevelPrompt = (length: string) => {
  if (length === 'collection') {
    return "【任务定位：行业信息收集与情报整理】\n本任务侧重于“广泛搜集”和“结构化整理”。请作为专业的情报分析师，不限于撰写分析结论，更重要的是将搜集到的核心事实、数据、政策、竞争对手动态等进行全景式罗列。必须严格注明资料出处，并对信息进行分类梳理。绝对不要撰写行业背景、研究意义、发展历程等水文内容。";
  }
  if (length.includes('3000')) {
    return "【报告定位：精简速览级】\n本报告侧重于“广度优先”和“信息汇总”。请提供全景式的行业扫描，快速提取核心数据和关键洞察，无需过度深挖单一技术细节，重点在于帮助读者快速建立全局认知。";
  } else if (length.includes('5000')) {
    return "【报告定位：深度研报级】\n本报告侧重于“垂直挖掘”和“方向收窄”。请在梳理全局的基础上，迅速收窄研究方向，对某一核心领域、关键技术或特定市场进行深度剖析，提供多维度的交叉验证和底层逻辑分析。";
  } else {
    return "【报告定位：专业研报级】\n本报告侧重于“行业前沿”和“战略反馈”。请以顶级行业专家的视角，不仅提供最前沿的技术/市场深度分析，还必须包含深度思考、未来趋势的推演，以及具有实操价值的战略建议和反馈。";
  }
};

const getCriticLevelPrompt = (length: string) => {
  if (length === 'collection') {
    return `5. 级别适配度（行业信息收集）：资料是否详尽？是否覆盖了用户要求的所有维度？是否每一条核心信息都注明了出处？如果发现草稿中包含了“行业背景”、“研究意义”、“发展历程”等水文内容，请严厉打回并要求删除。如果发现草稿没有使用列表（Bullet points）或表格进行高度结构化呈现，请打回并要求重写。`;
  }
  if (length.includes('3000')) {
    return `6. 级别适配度（精简速览级）：草稿是否做到了“广度优先”和“高度概括”？如果发现草稿过度深挖单一技术细节而忽略了全局视野，或者缺乏核心信息的提炼，请扣分并要求精简提炼。`;
  } else if (length.includes('5000')) {
    return `6. 级别适配度（深度研报级）：草稿是否做到了“垂直挖掘”和“多维验证”？如果发现草稿仅仅是泛泛而谈的表面信息汇总，缺乏对核心逻辑的深度剖析和数据的交叉验证，请打回并要求加深分析深度。`;
  } else {
    return `6. 级别适配度（专业研报级）：草稿是否展现了“顶级专家视角”和“战略价值”？如果发现草稿缺乏前瞻性的趋势推演、没有深度的战略思考，或者给出的建议过于空泛缺乏实操性，请严厉打回并要求补充专业洞察与战略反馈。`;
  }
};

const runDeepResearch = async (taskId: string, topic: string, length: string, user: string, providedOutline?: any, filePaths: string[] = []) => {
  runningTask = { id: taskId, topic, user, progress: 0, status: 'running' };
  setCurrentRunningTask({ taskId, username: user, topic });
  broadcastSystemStatus();
  const reportsDir = path.join(__dirname, 'reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  
  let filePath = '';
  const modelPlanner = getSetting('model_planner', 'qwen-plus');
  const modelWriter = getSetting('model_writer', 'qwen-plus');
  const modelCritic = getSetting('model_critic', 'qwen-plus');
  const currentDateStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

  let outline = providedOutline;
  let currentChapterIndex = 0;
  let chapterStates: any[] = [];
  let feishuDocId: string | null = null;
  const previousChapterSummaries: { chapter: string, summary: string }[] = [];

  try {
    const taskRecord = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
    if (taskRecord && (taskRecord.current_chapter_index > 0 || (taskRecord.chapter_states && taskRecord.chapter_states !== '[]'))) {
      currentChapterIndex = taskRecord.current_chapter_index || 0;
      chapterStates = JSON.parse(taskRecord.chapter_states || '[]');
      if (!outline && taskRecord.outline) {
        outline = JSON.parse(taskRecord.outline);
      }
      if (taskRecord.file_path) filePath = taskRecord.file_path;
      if (taskRecord.feishu_doc_id) feishuDocId = taskRecord.feishu_doc_id;
      if (taskRecord.file_paths) filePaths = JSON.parse(taskRecord.file_paths);
      
      // Restore previous chapter summaries from chapterStates
      for (const state of chapterStates) {
        if (state.type === 'chapter' && state.summary) {
          previousChapterSummaries.push({
            chapter: `第 ${state.index + 1} 章：${state.title}`,
            summary: state.summary
          });
        }
      }
      broadcastLog(taskId, `🔄 发现中断的任务，正在从第 ${currentChapterIndex + 1} 章恢复生成...`, 'info');
    } else {
      broadcastLog(taskId, `🚀 任务启动：${topic}`, 'success');
      await sendNotifications(`🚀 深度研究已启动！\n课题：${topic}\n任务ID：${taskId}`);
    }

    if (!outline) {
      broadcastLog(taskId, `🧠 正在调用规划师 (${modelPlanner}) 生成大纲...`);
      
      const levelPrompt = getLevelPrompt(length);
      const plannerPrompt = length === 'collection' ? 
      `你是一个只输出 JSON 的数据转换接口。
当前系统日期：${currentDateStr}。
请根据用户探讨的课题：【${topic}】，生成一份“行业信息收集与情报整理”大纲。
预期篇幅：广泛搜集，不设严格字数上限，但需确保信息密度。
${levelPrompt}

【致命约束】
1. 严禁偏离主题。所有章节必须紧扣课题：【${topic}】。
2. 章节设计应侧重于“事实罗列”和“情报分类”（如：政策环境、市场竞争、技术动态、重点企业、风险预警等）。绝对不要设计“行业背景”、“研究意义”、“发展历程”等水文章节。
3. 绝对禁止输出任何 Markdown 标记（如 \`\`\`json\`）、禁止输出任何问候语或解释。
4. 必须严格遵守以下 JSON 结构：
{
  "report_title": "情报整理：${topic}",
  "executive_summary_points": "本次情报搜集的整体背景与核心价值点总结",
  "chapters": [
    {
      "chapter_num": 1,
      "chapter_title": "第一章：...",
      "core_points": "本章需要搜集的核心情报维度，请确保涵盖广泛的信息点。"
    }
  ]
}` : 
      `你是一个只输出 JSON 的数据转换接口。
当前系统日期：${currentDateStr}。请基于此真实时间背景，对未来趋势进行前瞻性预测，并在提及“近几年”时以此日期为基准。
请根据用户探讨的课题：【${topic}】，生成一份深度研究报告大纲。
预期【正文】篇幅：${length}字（不含执行摘要、参考文献）。
${levelPrompt}

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

      try {
        const rawJsonRaw = await streamLLMWithProgress(
          getLLMClient('planner'),
          modelPlanner,
          [{ role: 'user', content: plannerPrompt }],
          0.1,
          taskId,
          broadcastLog,
          '正在规划大纲'
        );

        let rawJson = rawJsonRaw || '';
        rawJson = rawJson.replace(/```json/g, '').replace(/```/g, '').trim();
        outline = JSON.parse(rawJson);
      } catch (e: any) {
        const errCode = e.response?.status || e.code || 'UNKNOWN';
        throw new Error(`[大纲规划模块] 生成大纲失败。错误代码: ${errCode}, 原因: ${e.message}`);
      }
    } else if (currentChapterIndex === 0) {
      broadcastLog(taskId, `✅ 已接收用户确认的大纲，共 ${outline.chapters.length} 章。`);
    }

    if (currentChapterIndex === 0 && chapterStates.length === 0) {
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
        const summaryPrompt = length === 'collection' ?
        `你是一位专业的情报分析师。当前系统日期：${currentDateStr}。请根据情报标题【${outline.report_title}】和以下核心要点，撰写一份“情报搜集综述”。
        
核心要点：${outline.executive_summary_points}

要求：
1. 简要说明本次情报搜集的覆盖范围（1-2句话）。
2. 使用 Markdown 列表（Bullet points）提炼出最具价值的 3-5 条核心情报。
3. 语言精炼，直接输出正文，绝对不要任何开场白或结束语。` :
        `你是一位顶级的战略咨询顾问。当前系统日期：${currentDateStr}。请根据报告标题【${outline.report_title}】和以下核心要点，撰写一份极具洞察力的“执行摘要（Executive Summary）”。
        
核心要点：${outline.executive_summary_points}

要求：
1. 站在行业高度，总结核心发现。
2. 揭示不同信息链条之间的内在逻辑联系。
3. 给出具有前瞻性的战略建议。
4. 篇幅约 500-800 字，直接输出正文，不要任何开场白。`;

        const summaryText = await streamLLMWithProgress(
          getLLMClient('writer'),
          modelWriter,
          [{ role: 'user', content: summaryPrompt }],
          0.5,
          taskId,
          broadcastLog,
          '正在撰写执行摘要'
        );
        
        const summaryContent = `## 执行摘要 (Executive Summary)\n\n${summaryText}\n\n---\n\n`;
        fs.appendFileSync(filePath, summaryContent);
        if (feishuDocId) await appendToFeishuDoc(feishuDocId, summaryContent);
        
        chapterStates.push({
          type: 'summary',
          content: summaryContent
        });
        
        // Save initial state
        db.prepare('UPDATE tasks SET current_chapter_index = ?, chapter_states = ?, outline = ?, file_path = ?, feishu_doc_id = ?, file_paths = ? WHERE id = ?')
          .run(0, JSON.stringify(chapterStates), JSON.stringify(outline), filePath, feishuDocId, JSON.stringify(filePaths), taskId);
          
      } catch (e: any) {
        broadcastLog(taskId, `⚠️ 执行摘要生成失败: ${e.message}`, 'warning');
      }
    } else if (chapterStates.length > 0) {
      // Reconstruct file if resuming
      broadcastLog(taskId, `🔄 正在重建本地文件...`, 'info');
      if (!filePath) {
        const safeTitle = outline.report_title.replace(/[\/\\?%*:|"<>]/g, '-');
        filePath = path.join(reportsDir, `${user}-${safeTitle}-resumed-${Date.now()}.md`);
      }
      fs.writeFileSync(filePath, `# ${outline.report_title}\n\n> 本报告由 Deep Research Web 自动生成。\n> 课题：${topic}\n\n---\n\n`);
      for (const state of chapterStates) {
        if (state.type === 'summary') {
          fs.appendFileSync(filePath, state.content);
        } else if (state.type === 'chapter') {
          fs.appendFileSync(filePath, `${state.content}\n\n`);
        }
      }
    }

    let knowledgeBase: DocumentChunk[] = [];
    try {
      knowledgeBase = await buildKnowledgeBase(topic, outline, broadcastLog, taskId, length, filePaths);
    } catch (e: any) {
      broadcastLog(taskId, `⚠️ 构建 RAG 知识库失败: ${e.message}。将降级使用传统单次检索。`, 'warning');
    }

    for (let i = currentChapterIndex; i < outline.chapters.length; i++) {
      const chapter = outline.chapters[i];
      const cleanTitle = chapter.chapter_title.trim().replace(/^(第\s*[\d一二三四五六七八九十百]+\s*章[：:\s]*)+/, '').trim();
      runningTask.progress = 10 + Math.floor((i / outline.chapters.length) * 80);
      broadcastLog(taskId, `🔍 开始处理：${chapter.chapter_title}`);
      
      let searchResults = '';
      let finalContentForState = '';
      try {
        if (knowledgeBase.length > 0) {
          broadcastLog(taskId, `🌐 正在从专属 RAG 知识库中检索本章素材...`);
          searchResults = await queryKnowledgeBase(`${topic} ${chapter.chapter_title} ${chapter.core_points}`, knowledgeBase, 8);
          broadcastLog(taskId, `✅ RAG 检索完成，已提取最相关的参考片段。`, 'success');
          
          // Multi-hop Research Logic
          broadcastLog(taskId, `🕵️ 正在调用研究员智能体 (Research Agent) 评估素材饱和度...`);
          const researchPrompt = length === 'collection' ? 
`你是一位严谨的情报检索专家。当前系统日期：${currentDateStr}。请评估以下检索到的参考素材是否足以支撑本章节的情报整理。
【课题名称】：${topic}
【章节标题】：${cleanTitle}
【核心情报维度】：${chapter.core_points}
    
【当前检索到的素材】：
${searchResults}

请判断当前素材是否已经广泛覆盖了要求的核心情报维度（例如是否包含足够多的具体数据、政策细节、竞品动态等）。如果信息覆盖面不足或缺乏具体事实，请提供 3-5 个具体的长尾搜索词（Query），以便进行二次广泛检索。如果信息已经非常丰富且覆盖全面，请将 is_sufficient 设为 true。
请严格按照以下 JSON 格式输出（不要输出任何其他内容）：
{
  "is_sufficient": false,
  "reason": "缺乏2025年的具体市场规模数据和头部企业的最新市占率",
  "new_queries": ["2025年 Q1 固态电池 市场规模", "2025年 宁德时代 固态电池 进展", "固态电池 最新政策 2025"]
}` :
`你是一位严谨的研究员。当前系统日期：${currentDateStr}。请评估以下检索到的参考素材是否足以支撑本章节的撰写。
【课题名称】：${topic}
【章节标题】：${cleanTitle}
【核心论点】：${chapter.core_points}
    
【当前检索到的素材】：
${searchResults}

请判断当前素材是否充分（例如是否包含最新的具体数据、案例等）。如果信息不足，请提供 1-3 个具体的长尾搜索词（Query），以便进行二次深度检索。如果信息已经非常充分，请将 is_sufficient 设为 true。
请严格按照以下 JSON 格式输出（不要输出任何其他内容）：
{
  "is_sufficient": false,
  "reason": "缺乏2025年的具体市场规模数据和头部企业的最新市占率",
  "new_queries": ["2025年 Q1 固态电池 市场规模", "2025年 宁德时代 固态电池 进展"]
}`;
          try {
            const researchResultStrRaw = await streamLLMWithProgress(
              getLLMClient('critic'),
              modelCritic,
              [{ role: 'user', content: researchPrompt }],
              0.3,
              taskId,
              broadcastLog,
              `正在评估第 ${chapter.chapter_num} 章检索结果`
            );
            
            let researchResultStr = researchResultStrRaw || '{}';
            const jsonMatch = researchResultStr.match(/\{[\s\S]*\}/);
            if (jsonMatch) researchResultStr = jsonMatch[0];
            const researchResult = JSON.parse(researchResultStr);
            
            if (!researchResult.is_sufficient && researchResult.new_queries && researchResult.new_queries.length > 0) {
              broadcastLog(taskId, `⚠️ 素材饱和度不足：${researchResult.reason}`, 'warning');
              broadcastLog(taskId, `🔍 触发多跳检索 (Multi-hop Research)，正在补充搜索：${researchResult.new_queries.join(', ')}`, 'info');
              
              const newChunks = await buildSupplementalKnowledgeBase(researchResult.new_queries, broadcastLog, taskId, length);
              if (newChunks.length > 0) {
                knowledgeBase.push(...newChunks);
                broadcastLog(taskId, `✅ 补充检索完成，知识库新增 ${newChunks.length} 个文本块。重新检索本章素材...`, 'success');
                searchResults = await queryKnowledgeBase(`${topic} ${chapter.chapter_title} ${chapter.core_points}`, knowledgeBase, 12);
              } else {
                 broadcastLog(taskId, `⚠️ 补充检索未获取到有效新信息，继续使用现有素材。`, 'warning');
              }
            } else {
              broadcastLog(taskId, `✅ 素材饱和度评估通过，信息已充分。`, 'success');
            }
          } catch (e: any) {
            broadcastLog(taskId, `⚠️ 饱和度评估失败，跳过补充检索: ${e.message}`, 'warning');
          }
        } else {
          broadcastLog(taskId, `🌐 正在调用博查 API 检索素材...`);
          let query = `${topic} ${chapter.chapter_title} ${chapter.core_points}`;
          if (length === 'collection') {
            // 行业信息收集模式：不加限制，广泛搜索
          } else if (length.includes('深度') || length.includes('专业') || length.includes('10000') || length.includes('20000')) {
            query += ' site:gov.cn OR site:edu.cn OR site:mckinsey.com';
          }
          searchResults = await withRetry(() => searchBocha(query, broadcastLog, taskId));
          broadcastLog(taskId, `✅ 检索完成，获取到有效参考素材。`, 'success');
        }
      } catch (e: any) {
        const errCode = e.response?.status || e.code || 'UNKNOWN';
        broadcastLog(taskId, `⚠️ [检索模块] 检索失败，将基于大模型自身知识撰写。错误代码: ${errCode}, 原因: ${e.message}`, 'warning');
        searchResults = '检索失败，请基于大模型自身知识撰写。';
      }

      try {
        broadcastLog(taskId, `✍️ 正在调用撰稿人 (${modelWriter}) 撰写本章正文...`);
        
        let contextPrompt = '';
        if (previousChapterSummaries.length > 0) {
          contextPrompt = `\n【前文内容摘要（全局记忆）】\n为了保证报告的连贯性，以下是前几章的核心内容摘要。请在撰写本章时，注意与前文的逻辑衔接，必要时可使用“正如前文所述”、“基于上一章的分析”等过渡语：\n`;
          previousChapterSummaries.forEach(s => {
            contextPrompt += `- ${s.chapter}: ${s.summary}\n`;
          });
        }

        const levelPrompt = getLevelPrompt(length);
        const writerPrompt = length === 'collection' ?
        `你是一位专业的情报分析师与资深撰稿人。
当前系统日期：${currentDateStr}。请基于此真实时间背景，对搜集到的情报进行整理。
请根据【课题名称】、【章节标题】以及提供的【参考素材】，撰写本章的情报整理内容。
${levelPrompt}
${contextPrompt}
【情报整理规范与要求】
1. 广泛罗列（核心）：尽可能详尽地罗列素材中提到的所有相关事实、具体数据、政策条款、竞争对手动态等。**绝对不要撰写行业背景、研究意义、发展历程等水文内容**。
2. 极致结构化：必须使用清晰的 Markdown 列表（Bullet points）、多级小标题或表格来组织信息。避免大段落的纯文本描述，确保内容极易被快速扫读（Scannable）。
3. 严格注明出处：每一条核心情报、数据或观点后面，**必须**用方括号标注来源（如：[来源1]、[来源2]）。
4. 核验幻觉：严禁捏造素材中不存在的信息。如果素材中没有相关信息，请直接说明“未搜集到相关详细信息”。
5. 数据表格优先：如果素材中有对比数据、时间序列数据或多维度信息，请务必优先将其整理成 Markdown 表格。
6. 章节编号：本章是情报整理的第 ${i + 1} 章。请务必使用 Markdown 二级标题（##）作为本章的主标题，例如：“## 第 ${i + 1} 章：${cleanTitle}”。
7. 参考文献列表：必须在本章正文的最后，设立“### 参考文献与数据源”小节，按顺序排列。
   - 必须使用【参考素材】中提供的真实来源。
   - 必须严格按照学术规范（如 GB/T 7714）的电子文献格式排版。
   - 格式要求：[序号] 主要责任者(若有). 题名 [EB/OL]. 出版项(或网站名称), 发表更新日期/引用日期. URL.
   - 示例：[1] 腾讯研究院. 2024年人工智能发展报告 [EB/OL]. 腾讯网, 2024. https://...
8. 严禁废话：直接输出正文，绝对不要输出任何开场白或结束语。

课题名称：${topic}
章节标题：${cleanTitle}
核心情报维度：${chapter.core_points}

参考素材：
${searchResults}` :
        `你是一位顶级的学术研究员与行业资深撰稿人。
当前系统日期：${currentDateStr}。请基于此真实时间背景，对未来趋势进行前瞻性预测，并在提及“近几年”、“当前”时严格以此日期为基准。
请根据【课题名称】、【章节标题】以及提供的【参考素材】，撰写本章的正文内容。
${levelPrompt}
${contextPrompt}
【学术规范与行文要求】
1. 严禁偏离主题：本章正文必须严格围绕【课题名称】、【章节标题】和【核心论点】展开，严禁插入任何与本课题无关的内容（如AI大模型、固态储氢、碳排放等，除非课题本身相关）。
2. 章节编号：本章是报告的第 ${i + 1} 章。请务必使用 Markdown 二级标题（##）作为本章的主标题，例如：“## 第 ${i + 1} 章：${cleanTitle}”。本章内的所有子标题请使用三级（###）或四级（####）标题。
3. 深度剖析：严禁简单的信息堆砌。你必须对搜集到的信息进行“链条式整合”，分析不同现象之间的因果关系、行业底层逻辑以及未来的演进趋势。
4. 行业洞察：融入你作为资深专家的行业思考，对技术瓶颈、市场博弈、政策导向进行深度推演。
5. 可视化图表：请务必在正文中包含至少一个高质量的 Markdown 可视化数据表格。**严禁使用 Mermaid 语法**。在表格前必须提供一个描述性的标题（使用标准的 Markdown 三级或四级标题，例如：### 2025年市场规模对比），以便系统自动生成图表标题。请根据数据类型提供不同结构的表格，例如：时间序列数据（年份/月份/季度作为第一列）、占比数据（单列数值，分类少于8个）、多维对比数据等，以便系统自动渲染为折线图、饼图或柱状图。注意：标题标记（#）不要重复，例如绝对不要写成“### ### 标题”或“#### ### 标题”。
6. 案例分析格式：若涉及案例研究，请使用“【案例分析】”标识，并采用缩进或引用块（>）形式突出显示，包含：背景、核心举措、成效评估、启示。**注意：案例中的具体对象（如公司名称、项目名称、机构名称等）必须明确写出真实名称，严禁使用“某单位”、“某项目”、“某公司”等模糊化处理。**
7. 强溯源与数据标注规范（解决幻觉）：
   - 只能从提供的【参考素材】中引用数据和观点，严禁凭空捏造数据或参考文献。
   - 所有关键数据和观点必须在句末使用方括号上标形式标注，如 [1]、[2]。
8. 交叉验证与事实核查（Fact-Checker）：
   - 如果两篇或多篇文档对同一个数据（如某行业市场规模、增长率等）给出了不同的数值，你必须同时列出不同来源的数据。
   - 分析数据差异的可能原因（如统计口径、发布时间、预测模型不同）。
   - 优先采信官方机构（如政府官网 .gov）、权威学术机构（.edu）或知名咨询公司/权威媒体的数据，并在正文中明确说明采信理由。
9. 参考文献列表：必须在本章正文的最后，设立“### 参考文献与数据源”小节，按顺序排列。
   - 必须使用【参考素材】中提供的真实来源。
   - 必须严格按照学术规范（如 GB/T 7714）的电子文献格式排版。
   - 格式要求：[序号] 主要责任者(若有). 题名 [EB/OL]. 出版项(或网站名称), 发表更新日期/引用日期. URL.
   示例：
   [1] 腾讯研究院. 2025年中国新能源产业发展报告 [EB/OL]. 腾讯网, 2025. https://example.com/report2025
   [2] 国家统计局. 最新人口结构数据 [EB/OL]. 国家统计局官网, 2025. https://example.com/data
10. 严禁废话：直接输出正文，绝对不要输出任何开场白或结束语。
11. 上下文连贯：请参考【前文内容摘要】，在合适的段落（如开头或过渡段）自然地互应前文，确保整份报告逻辑是一个整体，避免各章节割裂。
12. 动态大纲申请（可选）：如果在撰写本章的过程中，你发现某个子课题极其重要且资料丰富，值得单独成为一个新的章节，你可以在正文的**最末尾**（参考文献之后）使用以下 XML 格式向系统申请追加新章节。如果没有必要，请不要输出此部分。
<suggested_new_sections>
[
  {
    "chapter_title": "新章节的标题",
    "core_points": "新章节的核心论点和主要内容描述"
  }
]
</suggested_new_sections>

课题名称：${topic}
章节标题：${cleanTitle}
核心论点：${chapter.core_points}

参考素材：
${searchResults}`;

        let finalContent = '';
        let retryCount = 0;
        const maxRetries = 2;
        let criticFeedback = '';

        while (retryCount <= maxRetries) {
          const currentWriterPrompt = writerPrompt + (criticFeedback ? `\n\n【审稿人修改意见】\n你之前生成的草稿存在以下问题，请严格按照以下意见进行修改重写：\n${criticFeedback}` : '');
          
          let content = await streamLLMWithProgress(
            getLLMClient('writer'),
            modelWriter,
            [{ role: 'user', content: currentWriterPrompt }],
            0.6,
            taskId,
            broadcastLog,
            `正在撰写第 ${chapter.chapter_num} 章正文`
          );
          
          // 防止标题重复：如果内容没有以 ## 开头，或者没有包含当前章节标题，则手动加上
          finalContent = content;
          // 强制确保章节标题是二级标题 (##)
          finalContent = finalContent.replace(/^(#|###|####)\s+(第\s*\d+\s*章.*)/m, '## $2');
          // 修复重复的标题标记，如 "### ### 标题"
          finalContent = finalContent.replace(/^ {0,3}(#{1,6})\s+#{1,6}\s+/gm, '$1 ');
          // 修复缺少空格的标题标记，如 "###标题"
          finalContent = finalContent.replace(/^ {0,3}(#{1,6})([^#\s])/gm, '$1 $2');
          // 修复被加粗的标题标记，如 "**### 标题**"
          finalContent = finalContent.replace(/^ {0,3}\*\*(#{1,6})\s+(.*?)\*\*/gm, '$1 **$2**');
          
          // 移除 LLM 生成内容开头可能存在的旧标题（以防止我们后续添加标准标题时重复）
          // 匹配前 10 行内的标题
          const lines = finalContent.split('\n');
          for (let j = 0; j < Math.min(10, lines.length); j++) {
            const line = lines[j].trim();
            if (line === '') continue; // 跳过空行
            
            const cleanLine = line.replace(/^[#\s*]+/, '').replace(/[*#\s：:]+$/, '');
            const normalizedLine = cleanLine.replace(/\s+/g, '');
            const normalizedTitle = cleanTitle.replace(/[*#\s：:]+$/, '').replace(/\s+/g, '');
            
            const hasChapterKeyword = /^第[\d一二三四五六七八九十百千万]+章/.test(normalizedLine);
            const isExactMatch = normalizedLine === normalizedTitle || normalizedLine === `第${i+1}章${normalizedTitle}` || normalizedLine === `第${i+1}章:${normalizedTitle}` || normalizedLine === `第${i+1}章：${normalizedTitle}`;
            const isSentence = /[。.\!！\?？]$/.test(cleanLine);
            
            const titleWithoutChapter = normalizedLine.replace(/^(第[\d一二三四五六七八九十百千万]+章[：:]*)+/, '');
            const containsTitle = normalizedLine.includes(normalizedTitle) || (titleWithoutChapter.length > 3 && normalizedTitle.includes(titleWithoutChapter));
            const isShortChapterTitle = hasChapterKeyword && normalizedLine.length < 15;
            
            if (isExactMatch || (!isSentence && hasChapterKeyword && (isShortChapterTitle || containsTitle))) {
              lines.splice(j, 1);
              j--; // 调整索引
            } else if (/^#{1,4}\s+/.test(line)) {
              // 遇到其他正常的子标题（如 ### 2.1 市场概况），停止移除
              break;
            } else {
              // 遇到正文内容，停止移除
              break;
            }
          }
          finalContent = lines.join('\n').trim();
          
          // 统一在最前面加上标准标题
          finalContent = `## 第 ${i + 1} 章：${cleanTitle}\n\n${finalContent}`;

          // 调用审稿人
          broadcastLog(taskId, `🧐 正在调用审稿人 (${modelCritic}) 进行审查 (第 ${retryCount + 1} 次尝试)...`);
          const criticLevelPrompt = getCriticLevelPrompt(length);
          const criticPrompt = length === 'collection' ?
          `你是一位严谨的情报核查员。当前系统日期：${currentDateStr}。请严格对比【情报草稿】与【参考素材】，对情报进行核实。

【审查标准】
1. 事实核查（致命项）：草稿中提到的所有事实和数据是否都能在【参考素材】中找到对应？严禁幻觉。
2. 出处标注：是否每一条核心情报、数据或观点后面都用方括号标注了来源？
3. 结构化呈现：草稿是否避免了大段落纯文本？是否大量使用了 Markdown 列表（Bullet points）和表格？如果发现大段落水文，必须打回。
4. 拒绝水文（致命项）：草稿中是否包含了行业背景、研究意义、发展历程等无实质数据的废话？如果有，必须打回并要求删除。
5. 参考文献格式：草稿末尾是否包含“### 参考文献与数据源”小节，且严格按照学术规范（如 GB/T 7714）排版？如果格式不规范，请打回。
${criticLevelPrompt}

【课题名称】：${topic}
【章节标题】：${cleanTitle}
【核心情报维度】：${chapter.core_points}
    
【参考素材】（证据链）：
${searchResults}

【情报草稿】：
${finalContent}

请严格按照以下 JSON 格式输出审查结果（不要输出任何其他内容，必须是合法的 JSON）：
{
  "score": 85,
  "feedback": "如果低于80分，请给出具体的修改意见；如果高于80分，可简短肯定。"
}` :
          `你是一位严苛的报告审稿人与事实核查员（Fact-Checker）。当前系统日期：${currentDateStr}。请严格对比【作者草稿】与【参考素材】，对草稿进行深度审查。

【审查标准】
1. 事实核查（致命项）：草稿中出现的任何具体数据（如金额、百分比、年份、专有名词），是否能在【参考素材】中找到明确出处？如果发现草稿捏造了素材中不存在的数据（幻觉），请立即打回（低于80分），并明确指出具体是哪一句话造假。
2. 是否跑题？（必须严格围绕课题和章节标题展开）
3. 内容充实度？（字数是否达标，论述是否深入）
4. 数据图表？（必须包含至少一个 Markdown 格式的数据表格，且表格数据必须来源于参考素材）
5. 案例具体化？（如果包含案例，是否明确指出了具体的公司、项目、机构名称，而不是使用“某单位”、“某项目”等模糊词汇。如果发现模糊化处理，请打回并要求写出具体名称）
6. 参考文献格式：草稿末尾是否包含“### 参考文献与数据源”小节，且严格按照学术规范（如 GB/T 7714）排版？如果格式不规范，请打回。
${criticLevelPrompt}

【课题名称】：${topic}
【章节标题】：${cleanTitle}
【核心论点】：${chapter.core_points}
    
【参考素材】（证据链）：
${searchResults}

【作者草稿】：
${finalContent}

请严格按照以下 JSON 格式输出审查结果（不要输出任何其他内容，必须是合法的 JSON）：
{
  "score": 85,
  "feedback": "如果低于80分，请给出具体的修改意见（特别是指出哪些数据存在幻觉）；如果高于80分，可简短肯定。"
}`;

          try {
            const criticResultStrRaw = await streamLLMWithProgress(
              getLLMClient('critic'),
              modelCritic,
              [{ role: 'user', content: criticPrompt }],
              0.1,
              taskId,
              broadcastLog,
              `正在审阅第 ${chapter.chapter_num} 章草稿`
            );
            
            let criticResultStr = criticResultStrRaw || '{}';
            // 尝试提取 JSON
            const jsonMatch = criticResultStr.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              criticResultStr = jsonMatch[0];
            }
            const criticResult = JSON.parse(criticResultStr);
            
            if (criticResult.score >= 80) {
              broadcastLog(taskId, `✅ 审稿通过！得分: ${criticResult.score}`, 'success');
              break;
            } else {
              if (retryCount < maxRetries) {
                broadcastLog(taskId, `⚠️ 审稿未通过 (得分: ${criticResult.score})。打回重写，意见: ${criticResult.feedback}`, 'warning');
                criticFeedback = criticResult.feedback;
              } else {
                broadcastLog(taskId, `⚠️ 审稿未通过，但已达到最大重试次数，强制采用当前版本。`, 'warning');
              }
            }
          } catch (e: any) {
            broadcastLog(taskId, `⚠️ 审稿过程发生错误，跳过审查: ${e.message}`, 'warning');
            break; // 审稿出错则直接采用当前草稿
          }
          
          retryCount++;
        }
        
        // 提取动态大纲申请 (Tree of Thoughts)
        const newSectionsMatch = finalContent.match(/<suggested_new_sections>([\s\S]*?)<\/suggested_new_sections>/);
        if (newSectionsMatch) {
          try {
            let newSectionsJson = newSectionsMatch[1].trim();
            // 移除可能存在的 Markdown 代码块标记
            newSectionsJson = newSectionsJson.replace(/^```\w*\s*/, '').replace(/\s*```$/, '').trim();
            const newSections = JSON.parse(newSectionsJson);
            if (Array.isArray(newSections) && newSections.length > 0) {
              const validSections = newSections.filter(s => s.chapter_title && s.core_points);
              if (validSections.length > 0) {
                broadcastLog(taskId, `🌱 触发动态大纲 (Tree of Thoughts)：AI 申请追加 ${validSections.length} 个新章节`, 'info');
                // 插入到当前章节之后
                let insertIndex = i + 1;
                validSections.forEach((s, idx) => {
                  outline.chapters.splice(insertIndex + idx, 0, {
                    chapter_num: outline.chapters.length + 1, // 编号仅作参考，实际以循环顺序为准
                    chapter_title: s.chapter_title,
                    core_points: s.core_points
                  });
                });
                broadcastLog(taskId, `✅ 动态大纲已更新，新增章节：${validSections.map(s => s.chapter_title).join(', ')}`, 'success');
              }
            }
          } catch (e) {
            logger.error(`Failed to parse suggested_new_sections: ${e}`);
          }
          // 从正文中移除该标记及其可能包含的 Markdown 代码块标记
          finalContent = finalContent.replace(/(?:```\w*\s*)?<suggested_new_sections>[\s\S]*?<\/suggested_new_sections>(?:\s*```)?/, '').trim();
        }

        finalContentForState = finalContent;
        fs.appendFileSync(filePath, `${finalContent}\n\n`);
        
        // 生成本章摘要，更新全局记忆
        try {
          broadcastLog(taskId, `📝 正在提取本章摘要，更新全局记忆库...`);
          const summaryPrompt = `请将以下报告章节内容压缩成150字左右的核心摘要，只保留最重要的结论和数据，用于后续章节的上下文记忆：\n\n${finalContent}`;
          const summary = await streamLLMWithProgress(
            getLLMClient('planner'),
            modelPlanner,
            [{ role: 'user', content: summaryPrompt }],
            0.3,
            taskId,
            broadcastLog,
            `正在提取第 ${chapter.chapter_num} 章摘要`
          );
          previousChapterSummaries.push({
            chapter: `第 ${i + 1} 章：${cleanTitle}`,
            summary: summary.trim()
          });
        } catch (e: any) {
          logger.error(`Failed to generate summary for chapter ${i + 1}: ${e.message}`);
          previousChapterSummaries.push({
            chapter: `第 ${i + 1} 章：${cleanTitle}`,
            summary: chapter.core_points
          });
        }

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
        const fallbackContent = `## 第 ${i + 1} 章：${cleanTitle}\n\n>[系统提示：本章节生成超时或API无响应，为防止工作流中断已跳过，请人工补充]`;
        fs.appendFileSync(filePath, `${fallbackContent}\n\n`);
        finalContentForState = fallbackContent;
        previousChapterSummaries.push({
          chapter: `第 ${i + 1} 章：${cleanTitle}`,
          summary: chapter.core_points
        });
      }

      // Save progress
      chapterStates.push({
        type: 'chapter',
        index: i,
        title: cleanTitle,
        content: finalContentForState,
        summary: previousChapterSummaries[previousChapterSummaries.length - 1].summary
      });
      
      try {
        db.prepare('UPDATE tasks SET current_chapter_index = ?, chapter_states = ?, outline = ?, file_path = ?, feishu_doc_id = ?, file_paths = ? WHERE id = ?')
          .run(i + 1, JSON.stringify(chapterStates), JSON.stringify(outline), filePath, feishuDocId, JSON.stringify(filePaths), taskId);
        broadcastLog(taskId, `💾 任务进度已保存 (断点续传)`);
      } catch (e: any) {
        logger.error(`Failed to save task progress: ${e.message}`);
      }

      if (i < outline.chapters.length - 1) {
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
    setCurrentRunningTask(null);
    broadcastSystemStatus();
    if (taskQueue.length > 0) {
      const nextTask = taskQueue.shift()!;
      runDeepResearch(nextTask.id, nextTask.topic, nextTask.length || '深度研报级', nextTask.user, nextTask.outline, nextTask.filePaths).catch(e => {
        logger.error(`Failed to resume task ${nextTask.id}: ${e.message}`);
        db.prepare("UPDATE tasks SET status = 'failed' WHERE id = ?").run(nextTask.id);
      });
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
  const { aliyun_api_key, llm_base_url, model_planner, http_proxy, planner_api_key, planner_base_url } = req.body;
  const diagnostics: any[] = [];
  
  const apiKey = planner_api_key || aliyun_api_key;
  const baseURL = planner_base_url || llm_base_url || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  
  try {
    const url = new URL(baseURL);
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
      apiKey, 
      baseURL,
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
  const keys = [
    'aliyun_api_key', 'llm_base_url', 
    'model_planner', 'model_writer', 'model_critic', 'model_embedding', 'model_vision',
    'planner_api_key', 'planner_base_url',
    'writer_api_key', 'writer_base_url',
    'critic_api_key', 'critic_base_url',
    'embedding_api_key', 'embedding_base_url',
    'vision_api_key', 'vision_base_url',
    'bocha_api_key', 'tg_bot_token', 'tg_chat_id', 'feishu_app_id', 'feishu_app_secret', 'http_proxy'
  ];
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
app.post('/api/upload', authenticateToken, upload.array('files', 5), (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }
    const filePaths = files.map(f => f.path);
    res.json({ filePaths, message: 'Files uploaded successfully' });
  } catch (e: any) {
    logger.error(`Error uploading files: ${e.message}`);
    res.status(500).json({ error: `上传文件失败: ${e.message}` });
  }
});

app.post('/api/research', authenticateToken, (req, res) => {
  try {
    const { topic, length, outline, filePaths } = req.body;
    if (!topic) return res.status(400).json({ error: 'Topic is required' });

    const taskId = Date.now().toString();
    const user = (req as any).user.username;
    
    const today = new Date().toISOString().split('T')[0];
    const userData = db.prepare('SELECT quota, daily_limit, total_quota, used_quota, daily_used, last_reset_date FROM users WHERE username = ?').get(user) as any;
    
    if (userData && (req as any).user.role !== 'admin') {
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

    db.prepare('INSERT INTO tasks (id, topic, status, length, user, outline, file_paths) VALUES (?, ?, ?, ?, ?, ?, ?)').run(taskId, topic, 'running', length, user, outline ? JSON.stringify(outline) : null, filePaths ? JSON.stringify(filePaths) : null);
    db.prepare('UPDATE users SET quota = quota - 1, used_quota = used_quota + 1, daily_used = daily_used + 1 WHERE username = ?').run(user);
    
    logger.info(`User ${user} started research task: ${topic}`);
    runDeepResearch(taskId, topic, length, user, outline, filePaths || []).catch(e => {
      logger.error(`Task ${taskId} failed: ${e.message}`);
      db.prepare("UPDATE tasks SET status = 'failed' WHERE id = ?").run(taskId);
    });
    
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
  res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering for Nginx/Lucky
  
  // Explicitly set CORS for SSE as some browsers/proxies are strict with EventSource
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

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
  res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering for Nginx/Lucky
  
  // Explicitly set CORS for SSE as some browsers/proxies are strict with EventSource
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.flushHeaders();

  const onLog = (data: string) => res.write(`data: ${data}\n\n`);
  const onDone = (data: string = "{}") => res.write(`event: done\ndata: ${data}\n\n`);

  // Send existing logs first to prevent "Waiting for server logs..." if frontend connects late
  try {
    const logFile = path.join(__dirname, 'logs', `task-${taskId}.log`);
    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      lines.forEach(line => {
        const match = line.match(/^\[(.*?)\] \[(.*?)\] (.*)$/);
        if (match) {
          const [_, timestamp, level, message] = match;
          res.write(`data: ${JSON.stringify({ timestamp, message, type: level.toLowerCase() })}\n\n`);
        }
      });
    }
  } catch (e) {
    logger.error(`Failed to fetch existing logs for SSE: ${e}`);
  }

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
    const client = getLLMClient('planner');
    
    const currentDateStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
    const messages = [
      { 
        role: 'system', 
        content: `你是一个专业的行业分析师。当前系统日期：${currentDateStr}。你的任务是通过多轮对话（共4-5轮）向用户提问，以明确研究报告的边界、重点企业和特殊要求。每次提出3-5个核心问题，然后等待用户回答。绝对不要自己模拟完整的对话过程，不要自问自答。` 
      },
      ...req.body.messages
    ];

    const response = await client.chat.completions.create({
      model: getSetting('model_planner', 'qwen-plus'),
      messages: messages,
    });
    res.json({ reply: response.choices[0].message.content });
  } catch (e: any) {
    logger.error(`Chat API Error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/generate-outline', authenticateToken, async (req, res) => {
  try {
    const { topic, length, messages } = req.body;
    const client = getLLMClient('planner');
    const currentDateStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
    const levelPrompt = getLevelPrompt(length);
    const prompt = length === 'collection' ? 
      `你是一个只输出 JSON 的数据转换接口。
当前系统日期：${currentDateStr}。
请根据用户探讨的课题：【${topic}】，以及之前的对话记录，生成一份“信息收集与情报整理”大纲。
预期篇幅：根据用户需求精准搜集，不设严格字数上限，但需确保信息密度。
${levelPrompt}

【致命约束】
1. 严禁偏离主题和用户在对话中明确的需求。如果用户只需要特定方向（如“案例调研”），大纲必须100%聚焦于该方向，绝对不要自行添加“政策环境”、“宏观市场”、“技术原理”等无关章节！
2. 章节设计应完全基于用户需求进行分类（例如：按应用场景分类、按时间线分类、按企业分类等），侧重于“事实罗列”和“精准情报”。绝对不要设计“行业背景”、“研究意义”、“发展历程”等水文章节。
3. 绝对禁止输出任何 Markdown 标记（如 \`\`\`json\`）、禁止输出任何问候语或解释。
4. 必须严格遵守以下 JSON 结构：
{
  "report_title": "情报整理：${topic}",
  "executive_summary_points": "本次情报搜集的核心目标与筛选标准总结",
  "chapters": [
    {
      "chapter_num": 1,
      "chapter_title": "第一章：...",
      "core_points": "本章需要搜集的具体情报内容，请确保与用户需求强相关。"
    }
  ]
}` : 
      `你是一个只输出 JSON 的数据转换接口。当前系统日期：${currentDateStr}。请基于此真实时间背景，对未来趋势进行前瞻性预测。请根据用户探讨的课题：【${topic}】，以及之前的对话记录，生成一份深度研究报告大纲。预期篇幅：${length}字。
${levelPrompt}

必须严格遵守以下 JSON 结构：
{
  "report_title": "报告主标题",
  "executive_summary_points": "执行摘要的核心要点，需包含核心发现、行业趋势总结和战略建议",
  "chapters": [
    {
      "chapter_num": 1,
      "chapter_title": "第一章：...",
      "core_points": "本章需要探讨的核心论点..."
    }
  ]
}`;

    const chatMessages = messages && Array.isArray(messages) ? messages.map((m: any) => ({ role: m.role, content: m.content })) : [];
    chatMessages.push({ role: 'user', content: prompt });

    const response = await client.chat.completions.create({
      model: getSetting('model_planner', 'qwen-plus'),
      messages: chatMessages,
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
    
    // Resume interrupted tasks
    try {
      const interruptedTasks = db.prepare("SELECT * FROM tasks WHERE status = 'running' OR status = 'interrupted'").all() as any[];
      for (const task of interruptedTasks) {
        if (task.current_chapter_index > 0 || (task.chapter_states && task.chapter_states !== '[]')) {
          logger.info(`Found interrupted task: ${task.id} - ${task.topic}. Queuing for resume...`);
          // Mark as interrupted briefly to trigger resume logic cleanly
          db.prepare("UPDATE tasks SET status = 'interrupted' WHERE id = ?").run(task.id);
          
          taskQueue.push({
            id: task.id,
            topic: task.topic,
            user: task.user || 'admin',
            length: task.length || '深度研报级',
            filePaths: task.file_paths ? JSON.parse(task.file_paths) : []
          });
        } else {
          // If it hasn't even started chapter 1, just mark it as failed
          db.prepare("UPDATE tasks SET status = 'failed' WHERE id = ?").run(task.id);
        }
      }
      
      // Start the first task in queue if not already running
      if (taskQueue.length > 0 && !currentRunningTask) {
        const nextTask = taskQueue.shift()!;
        runDeepResearch(nextTask.id, nextTask.topic, nextTask.length || '深度研报级', nextTask.user, undefined, nextTask.filePaths).catch(e => {
          logger.error(`Failed to resume task ${nextTask.id}: ${e.message}`);
          db.prepare("UPDATE tasks SET status = 'failed' WHERE id = ?").run(nextTask.id);
        });
      }
    } catch (e: any) {
      logger.error(`Failed to check for interrupted tasks: ${e.message}`);
    }
  });
}

startServer();
