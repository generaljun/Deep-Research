import axios from 'axios';
import OpenAI from 'openai';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { logger, getSetting, withRetry, getLLMClient, getProxyAgent, streamLLMWithProgress } from './utils.js';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

// RAG & Vector Store Helpers
// ==========================================

export interface DocumentChunk {
  text: string;
  url: string;
  title: string;
  documentSummary?: string;
  embedding?: number[];
}

function chunkText(text: string, chunkSize: number = 1000, overlap: number = 200): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += chunkSize - overlap;
  }
  return chunks;
}

function cosineSimilarity(a: number[], b: number[]) {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

const getEmbeddingsBatched = async (texts: string[], batchSize = 20, broadcastLog?: any, taskId?: string): Promise<number[][]> => {
  const client = getLLMClient('embedding');
  const model = getSetting('model_embedding', 'text-embedding-v3');
  const embeddings: number[][] = [];
  
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    try {
      const response = await client.embeddings.create({
        model,
        input: batch,
      });
      // Ensure order matches
      const batchEmbeddings = response.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
      embeddings.push(...batchEmbeddings);
      if (broadcastLog && taskId) {
        broadcastLog(taskId, `⚙️ 向量化进度: ${Math.min(i + batchSize, texts.length)}/${texts.length}...`, 'info');
      }
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (e: any) {
      logger.error(`Embedding batch failed: ${e.message}`);
      // Fill with zeros if failed to keep alignment
      batch.forEach(() => embeddings.push(new Array(1536).fill(0)));
    }
  }
  return embeddings;
};

const generateDocumentSummary = async (text: string, title: string, broadcastLog?: any, taskId?: string): Promise<string> => {
  const client = getLLMClient('critic');
  const modelCritic = getSetting('model_critic', 'qwen-turbo');
  
  if (text.length < 1500) return text;
  
  const truncatedText = text.substring(0, 15000); 
  
  const prompt = `你是一位专业的情报分析师。请对以下长篇文档（标题：${title}）进行高密度浓缩。
要求：
1. 提取核心数据（如金额、百分比、年份）。
2. 提取关键结论和核心观点。
3. 提取实体关系（如主要企业、政策、技术路线）。
4. 篇幅控制在 500-800 字左右，直接输出摘要，不要任何废话。

【文档内容】：
${truncatedText}`;

  try {
    const summary = await streamLLMWithProgress(
      client,
      modelCritic,
      [{ role: 'user', content: prompt }],
      0.3,
      taskId || '',
      broadcastLog,
      `正在浓缩文档: ${title.substring(0, 15)}...`
    );
    return summary || '';
  } catch (e: any) {
    if (broadcastLog && taskId) {
      broadcastLog(taskId, `⚠️ 文档摘要生成失败 (${title}): ${e.message}`, 'warning');
    }
    return text.substring(0, 1000) + '...'; // fallback
  }
};

const fetchJinaReader = async (url: string) => {
  try {
    const response = await axios.get(`https://r.jina.ai/${url}`, {
      timeout: 15000,
      headers: { 'Accept': 'text/plain' }
    });
    return response.data;
  } catch (e: any) {
    return null;
  }
};

export const searchBocha = async (query: string, broadcastLog?: any, taskId?: string) => {
  const apiKey = getSetting('bocha_api_key');
  const proxyUrl = getSetting('http_proxy');
  
  if (!apiKey) throw new Error('未配置博查 API Key，请前往后台设置。');
  
  const axiosConfig: any = {
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    family: 4, // 强制使用 IPv4，解决部分 NAS 环境 IPv6 路由问题
    timeout: 15000
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
  if (results.length === 0) return '未检索到相关内容。';

  // 1. 根据查询词是否包含白名单（代表深度研报）来决定是否过滤内容农场
  const isDeepQuery = query.includes('site:gov.cn');
  const contentFarms = ['baijiahao.baidu.com', 'sohu.com', '163.com', 'zhihu.com/question', 'bilibili.com'];
  
  let targetResults = results;
  
  if (isDeepQuery) {
    // 如果是深度研报，优先过滤内容农场，提取高质量链接
    const highQualityResults = results.filter((r: any) => {
      return !contentFarms.some(farm => r.url.includes(farm));
    });
    // 如果过滤后还有结果，就用高质量结果，否则降级使用全部结果
    targetResults = highQualityResults.length > 0 ? highQualityResults : results;
  } else {
    // 如果是精简报告，保留所有结果，包括百家号等，以获取更多最新小众信息
    targetResults = results;
  }
  
  // 2. 选取 Top 3 链接进行深度抓取
  const topLinks = targetResults.slice(0, 3);
  const otherLinks = targetResults.slice(3, 8);

  if (broadcastLog && taskId) {
    broadcastLog(taskId, `📚 正在对 Top ${topLinks.length} 链接进行深度阅读 (Deep Scraping)...`);
  }
  
  let finalContext = '';
  
  // 并发抓取 Top 3
  const scrapePromises = topLinks.map(async (r: any, index: number) => {
    try {
      const fullText = await fetchJinaReader(r.url);
      if (fullText && fullText.length > 200) {
        // 截断过长的文本，防止 token 超出 (保留前 3000 字符)
        const truncatedText = fullText.substring(0, 3000);
        return `\n### 来源 ${index + 1}: [${r.name}](${r.url})\n【全文/深度内容】:\n${truncatedText}...\n`;
      }
    } catch (e) {
      // 忽略错误，降级使用 snippet
    }
    return `\n### 来源 ${index + 1}: [${r.name}](${r.url})\n【摘要】: ${r.snippet}\n`;
  });

  const scrapedContents = await Promise.all(scrapePromises);
  finalContext += scrapedContents.join('\n');

  if (otherLinks.length > 0) {
    finalContext += `\n### 其他参考来源 (摘要):\n`;
    finalContext += otherLinks.map((r: any) => `- [${r.name}](${r.url}): ${r.snippet}`).join('\n');
  }

  return finalContext;
};

const extractImageUrls = (markdown: string): { url: string, alt: string }[] => {
  const regex = /!\[([^\]]*)\]\((https?:\/\/[^\)]+)\)/g;
  const images: { url: string, alt: string }[] = [];
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    images.push({ alt: match[1], url: match[2] });
  }
  return images;
};

const analyzeImageWithVLM = async (imageUrl: string, context: string, broadcastLog?: any, taskId?: string): Promise<string | null> => {
  try {
    const client = getLLMClient('vision');
    const modelVision = getSetting('model_vision', 'qwen-vl-max'); // 默认使用 qwen-vl-max
    
    const prompt = `你是一个专业的数据分析师。请提取这张数据图表中的所有关键数据，并转换为 Markdown 表格。如果这不是一张包含数据的图表（如纯装饰性图片、人像等），请直接回复“非数据图表”。\n上下文信息：${context}`;
    
    const response = await withRetry(() => client.chat.completions.create({
      model: modelVision,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } }
          ] as any
        }
      ],
      temperature: 0.1,
    }), 2, 2000, broadcastLog, taskId);
    
    const result = response.choices[0].message.content || '';
    if (result.includes('非数据图表') || result.trim() === '') return null;
    return result;
  } catch (e: any) {
    if (broadcastLog && taskId) {
      broadcastLog(taskId, `⚠️ 图表解析失败 (${imageUrl}): ${e.message}`, 'warning');
    }
    return null;
  }
};

const parseLocalFile = async (filePath: string): Promise<string> => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.pdf') {
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdfParse(dataBuffer);
      return data.text;
    } else if (ext === '.docx') {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    } else if (ext === '.txt' || ext === '.md') {
      return fs.readFileSync(filePath, 'utf8');
    }
  } catch (e: any) {
    logger.error(`Failed to parse local file ${filePath}: ${e.message}`);
  }
  return '';
};

export const buildKnowledgeBase = async (topic: string, outline: any, broadcastLog: any, taskId: string, length: string = '2000', filePaths: string[] = []): Promise<DocumentChunk[]> => {
  broadcastLog(taskId, `🧠 启动 RAG 知识库构建：正在提取检索关键词...`, 'info');
  
  const isDeep = length.includes('深度') || length.includes('专业') || length.includes('10000') || length.includes('20000');
  const whitelist = ' site:gov.cn OR site:edu.cn OR site:mckinsey.com';
  
  // 1. 提取检索关键词
  const queries = new Set<string>();
  queries.add(topic + (isDeep ? whitelist : ''));
  outline.chapters.forEach((c: any) => {
    queries.add(`${topic} ${c.chapter_title}` + (isDeep ? whitelist : ''));
  });
  
  const queryArray = Array.from(queries).slice(0, 15); // 限制最多 15 个查询
  broadcastLog(taskId, `🌐 正在并发执行 ${queryArray.length} 个深度检索任务...`, 'info');

  // 2. 并发检索
  const apiKey = getSetting('bocha_api_key');
  if (!apiKey) {
    broadcastLog(taskId, `⚠️ 未配置 Bocha API Key，跳过知识库构建。`, 'warning');
    return [];
  }
  const proxyUrl = getSetting('http_proxy');
  const axiosConfig: any = {
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    family: 4
  };
  if (proxyUrl) {
    const agent = getProxyAgent(proxyUrl);
    axiosConfig.httpsAgent = agent;
    axiosConfig.httpAgent = agent;
    axiosConfig.proxy = false;
  }

  const allUrls = new Map<string, any>();
  
  const searchPromises = queryArray.map(async (query) => {
    try {
      const response = await axios.post(
        'https://api.bochaai.com/v1/web-search',
        { query, freshness: "noLimit", summary: true, count: 10 },
        axiosConfig
      );
      const results = response.data?.data?.webPages?.value || [];
      const contentFarms = ['baijiahao.baidu.com', 'sohu.com', '163.com', 'zhihu.com/question', 'bilibili.com'];
      results.forEach((r: any) => {
        if (!contentFarms.some(farm => r.url.includes(farm))) {
          if (!allUrls.has(r.url)) {
            allUrls.set(r.url, r);
          }
        }
      });
    } catch (e) {
      // 忽略单个查询失败
    }
  });
  
  await Promise.all(searchPromises);
  
  const uniqueResults = Array.from(allUrls.values()).slice(0, 50); // 最多抓取 50 个高质量链接
  broadcastLog(taskId, `📥 共收集到 ${uniqueResults.length} 个高质量参考链接，开始并发下载与解析...`, 'info');

  // 3. 并发抓取内容并分块 (分批进行以避免并发过高)
  const chunks: DocumentChunk[] = [];
  const batchSize = 10;
  for (let i = 0; i < uniqueResults.length; i += batchSize) {
    if (broadcastLog && taskId) {
      broadcastLog(taskId, `⏳ 正在抓取和解析第 ${i + 1} 到 ${Math.min(i + batchSize, uniqueResults.length)} 个参考链接...`, 'info');
    }
    const batch = uniqueResults.slice(i, i + batchSize);
    const scrapePromises = batch.map(async (r: any) => {
      try {
        const fullText = await fetchJinaReader(r.url);
        const textToChunk = (fullText && fullText.length > 200) ? fullText : r.snippet;
        if (textToChunk) {
          let docSummary = '';
          if (textToChunk.length >= 1500) {
            docSummary = await generateDocumentSummary(textToChunk, r.name, broadcastLog, taskId);
          } else {
            docSummary = textToChunk;
          }
          
          // --- VLM Integration Start ---
          const images = extractImageUrls(textToChunk);
          if (images.length > 0) {
            const topImages = images.slice(0, 3); // 限制最多解析 3 张图表
            if (broadcastLog && taskId) {
              broadcastLog(taskId, `👁️ 发现 ${images.length} 张图片，正在调用视觉大模型 (VLM) 尝试解析图表数据...`, 'info');
            }
            const vlmPromises = topImages.map(async (img) => {
              const tableData = await analyzeImageWithVLM(img.url, r.name, broadcastLog, taskId);
              if (tableData) {
                chunks.push({ 
                  text: `【图表数据提取】\n图表标题: ${img.alt || '未命名图表'}\n来源: ${r.url}\n数据内容:\n${tableData}`, 
                  url: r.url, 
                  title: `${r.name} - 图表数据`, 
                  documentSummary: docSummary 
                });
              }
            });
            await Promise.all(vlmPromises);
          }
          // --- VLM Integration End ---

          const textChunks = chunkText(textToChunk, 1000, 200);
          textChunks.forEach(text => {
            chunks.push({ text, url: r.url, title: r.name, documentSummary: docSummary });
          });
        }
      } catch (e) {
        if (r.snippet) {
          chunks.push({ text: r.snippet, url: r.url, title: r.name, documentSummary: r.snippet });
        }
      }
    });
    await Promise.all(scrapePromises);
    broadcastLog(taskId, `⏳ 网页抓取与摘要生成进度: ${Math.min(i + batchSize, uniqueResults.length)}/${uniqueResults.length}...`, 'info');
  }
  // 3.5 处理本地上传文件 (Hybrid RAG)
  if (filePaths && filePaths.length > 0) {
    broadcastLog(taskId, `📁 正在解析 ${filePaths.length} 个本地上传文件...`, 'info');
    for (const filePath of filePaths) {
      const fileName = path.basename(filePath);
      try {
        const fileText = await parseLocalFile(filePath);
        if (fileText && fileText.trim().length > 0) {
          const docSummary = await generateDocumentSummary(fileText, fileName, broadcastLog, taskId);
          const textChunks = chunkText(fileText, 1000, 200);
          textChunks.forEach(text => {
            chunks.push({ text, url: `local://${fileName}`, title: `[本地文件] ${fileName}`, documentSummary: docSummary });
          });
          broadcastLog(taskId, `✅ 本地文件 ${fileName} 解析完成，提取 ${textChunks.length} 个文本块。`, 'success');
        }
      } catch (e: any) {
        broadcastLog(taskId, `⚠️ 本地文件 ${fileName} 解析失败: ${e.message}`, 'warning');
      }
    }
  }

  broadcastLog(taskId, `🧩 解析完成，共生成 ${chunks.length} 个文本块。正在进行向量化 (Embedding)...`, 'info');

  // 4. 批量向量化
  const textsToEmbed = chunks.map(c => c.text);
  if (textsToEmbed.length === 0) {
    broadcastLog(taskId, `⚠️ 未提取到任何有效文本块，跳过向量化。`, 'warning');
    return [];
  }
  const embeddings = await getEmbeddingsBatched(textsToEmbed, 20, broadcastLog, taskId);
  
  chunks.forEach((chunk, i) => {
    chunk.embedding = embeddings[i];
  });
  
  broadcastLog(taskId, `✅ 专属 RAG 知识库构建完成！`, 'success');
  return chunks;
};

export const buildSupplementalKnowledgeBase = async (queries: string[], broadcastLog: any, taskId: string, length: string = '2000'): Promise<DocumentChunk[]> => {
  const apiKey = getSetting('bocha_api_key');
  if (!apiKey) return [];
  
  const isDeep = length.includes('深度') || length.includes('专业') || length.includes('10000') || length.includes('20000');
  const whitelist = ' site:gov.cn OR site:edu.cn OR site:mckinsey.com';
  const modifiedQueries = queries.map(q => q + (isDeep ? whitelist : ''));

  const proxyUrl = getSetting('http_proxy');
  const axiosConfig: any = {
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    family: 4
  };
  if (proxyUrl) {
    const agent = getProxyAgent(proxyUrl);
    axiosConfig.httpsAgent = agent;
    axiosConfig.httpAgent = agent;
    axiosConfig.proxy = false;
  }

  const allUrls = new Map<string, any>();
  const searchPromises = modifiedQueries.map(async (query) => {
    try {
      const response = await axios.post(
        'https://api.bochaai.com/v1/web-search',
        { query, freshness: "noLimit", summary: true, count: 5 },
        axiosConfig
      );
      const results = response.data?.data?.webPages?.value || [];
      const contentFarms = ['baijiahao.baidu.com', 'sohu.com', '163.com', 'zhihu.com/question', 'bilibili.com'];
      results.forEach((r: any) => {
        if (!contentFarms.some(farm => r.url.includes(farm))) {
          if (!allUrls.has(r.url)) {
            allUrls.set(r.url, r);
          }
        }
      });
    } catch (e) {
      // ignore
    }
  });
  await Promise.all(searchPromises);
  
  const uniqueResults = Array.from(allUrls.values()).slice(0, 10);
  if (uniqueResults.length === 0) return [];
  
  broadcastLog(taskId, `📥 补充检索收集到 ${uniqueResults.length} 个新链接，开始下载与解析...`, 'info');
  const chunks: DocumentChunk[] = [];
  const batchSize = 5;
  for (let i = 0; i < uniqueResults.length; i += batchSize) {
    if (broadcastLog && taskId) {
      broadcastLog(taskId, `⏳ 正在补充抓取和解析第 ${i + 1} 到 ${Math.min(i + batchSize, uniqueResults.length)} 个参考链接...`, 'info');
    }
    const batch = uniqueResults.slice(i, i + batchSize);
    const scrapePromises = batch.map(async (r: any) => {
      try {
        const fullText = await fetchJinaReader(r.url);
        const textToChunk = (fullText && fullText.length > 200) ? fullText : r.snippet;
        if (textToChunk) {
          let docSummary = '';
          if (textToChunk.length >= 1500) {
            docSummary = await generateDocumentSummary(textToChunk, r.name, broadcastLog, taskId);
          } else {
            docSummary = textToChunk;
          }
          
          // --- VLM Integration Start ---
          const images = extractImageUrls(textToChunk);
          if (images.length > 0) {
            const topImages = images.slice(0, 2); // 补充检索时限制为2张
            const vlmPromises = topImages.map(async (img) => {
              const tableData = await analyzeImageWithVLM(img.url, r.name, broadcastLog, taskId);
              if (tableData) {
                chunks.push({ 
                  text: `【图表数据提取】\n图表标题: ${img.alt || '未命名图表'}\n来源: ${r.url}\n数据内容:\n${tableData}`, 
                  url: r.url, 
                  title: `${r.name} - 图表数据`, 
                  documentSummary: docSummary 
                });
              }
            });
            await Promise.all(vlmPromises);
          }
          // --- VLM Integration End ---

          const textChunks = chunkText(textToChunk, 1000, 200);
          textChunks.forEach(text => {
            chunks.push({ text, url: r.url, title: r.name, documentSummary: docSummary });
          });
        }
      } catch (e) {
        if (r.snippet) {
          chunks.push({ text: r.snippet, url: r.url, title: r.name, documentSummary: r.snippet });
        }
      }
    });
    await Promise.all(scrapePromises);
  }
  
  const textsToEmbed = chunks.map(c => c.text);
  if (textsToEmbed.length === 0) return [];
  
  const embeddings = await getEmbeddingsBatched(textsToEmbed, 20, broadcastLog, taskId);
  chunks.forEach((chunk, i) => {
    chunk.embedding = embeddings[i];
  });
  
  return chunks;
};

export const queryKnowledgeBase = async (query: string, knowledgeBase: DocumentChunk[], topK: number = 5): Promise<string> => {
  if (!knowledgeBase || knowledgeBase.length === 0) return '未检索到相关内容。';
  
  try {
    const client = getLLMClient('embedding');
    const model = getSetting('model_embedding', 'text-embedding-v3');
    const response = await client.embeddings.create({
      model,
      input: query,
    });
    const queryEmbedding = response.data[0].embedding;
    
    const getDomainWeight = (url: string): number => {
      try {
        const parsedUrl = new URL(url);
        const hostname = parsedUrl.hostname.toLowerCase();
        
        // 1. 顶级域名白名单 (Top-level domains)
        if (hostname.endsWith('.gov') || hostname.endsWith('.edu')) {
          return 1.5; // 极高权重：政府、教育机构
        }
        if (hostname.endsWith('.org')) {
          return 1.1; // 较高权重：非营利组织
        }

        // 2. 权威机构/咨询公司/知名媒体白名单
        const authoritativeDomains = [
          'mckinsey.com', 'gartner.com', 'forrester.com', 'bain.com', 'bcg.com', // 咨询
          'bloomberg.com', 'reuters.com', 'wsj.com', 'ft.com', 'economist.com', // 财经媒体
          'statista.com', 'pewresearch.org', 'worldbank.org', 'imf.org', 'weforum.org', // 数据与研究
          'nature.com', 'science.org', 'ieee.org', 'acm.org', // 学术
          'gov.cn', 'stats.gov.cn', 'pbc.gov.cn', // 中国官方
          'xinhuanet.com', 'people.com.cn', 'cctv.com' // 中国官媒
        ];

        for (const domain of authoritativeDomains) {
          if (hostname === domain || hostname.endsWith(`.${domain}`)) {
            return 1.3; // 高权重：权威机构
          }
        }

        // 3. 内容农场/低质内容降权 (如果之前没过滤干净)
        const lowQualityDomains = [
          'baijiahao.baidu.com', 'zhihu.com', 'toutiao.com', 'sohu.com', '163.com', 'sina.com.cn',
          'csdn.net', 'jianshu.com', 'bilibili.com'
        ];
        for (const domain of lowQualityDomains) {
          if (hostname === domain || hostname.endsWith(`.${domain}`)) {
            return 0.7; // 降权：UGC或内容农场
          }
        }

        return 1.0; // 默认权重
      } catch (e) {
        return 1.0; // URL 解析失败则返回默认权重
      }
    };

    const scoredChunks = knowledgeBase.map(chunk => {
      const baseScore = cosineSimilarity(queryEmbedding, chunk.embedding!);
      const domainWeight = getDomainWeight(chunk.url);
      return {
        ...chunk,
        score: baseScore * domainWeight,
        baseScore,
        domainWeight
      };
    });
    
    scoredChunks.sort((a, b) => b.score - a.score);
    const topChunks = scoredChunks.slice(0, topK);
    
    let result = '';
    
    // 聚合宏观摘要
    const uniqueSummaries = new Map<string, string>();
    topChunks.forEach(chunk => {
      if (chunk.documentSummary && !uniqueSummaries.has(chunk.url)) {
        uniqueSummaries.set(chunk.url, chunk.documentSummary);
      }
    });
    
    if (uniqueSummaries.size > 0) {
      result += `【全局宏观视角（文档级摘要）】\n`;
      let summaryCount = 1;
      uniqueSummaries.forEach((summary, url) => {
        if (summaryCount <= 3) { // 最多提供 3 篇宏观摘要
          result += `--- 宏观摘要 ${summaryCount} ---\n${summary}\n`;
          summaryCount++;
        }
      });
      result += `\n【局部细节视角（相关文本块）】\n`;
    }

    topChunks.forEach((chunk, index) => {
      result += `\n### 来源 ${index + 1}: [${chunk.title}](${chunk.url})\n【内容片段】:\n${chunk.text}\n`;
    });
    return result;
  } catch (e: any) {
    logger.error(`RAG Query failed: ${e.message}`);
    // 降级：随机返回几个
    return knowledgeBase.slice(0, topK).map((c, index) => `\n### 来源 ${index + 1}: [${c.title}](${c.url})\n【内容片段】:\n${c.text}\n`).join('');
  }
};

export const sendNotifications = async (message: string) => {
  const tgToken = getSetting('tg_bot_token');
  const tgChatId = getSetting('tg_chat_id');
  const feishuAppId = getSetting('feishu_app_id');
  const feishuAppSecret = getSetting('feishu_app_secret');
  const proxyUrl = getSetting('http_proxy');

  if (tgToken && tgChatId) {
    const axiosConfig: any = { family: 4, timeout: 5000 };
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
  }, { timeout: 10000 });
  return res.data.tenant_access_token;
};

export const createFeishuDoc = async (title: string) => {
  const token = await getFeishuToken();
  if (!token) return null;

  const res = await axios.post('https://open.feishu.cn/open-apis/docx/v1/documents', {
    title: title
  }, {
    headers: { 'Authorization': `Bearer ${token}` },
    timeout: 10000
  });

  if (res.data.code === 0) {
    return res.data.data.document;
  }
  throw new Error(`创建飞书文档失败: ${res.data.msg}`);
};

export const appendToFeishuDoc = async (documentId: string, markdown: string) => {
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
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 10000
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

export const generateHtmlReport = (title: string, markdown: string, feishuUrl?: string, createdAt?: string) => {
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