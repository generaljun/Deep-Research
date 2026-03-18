# DeepResearch-NAS 🧠

![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2CA5E0?style=for-the-badge&logo=docker&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-07405E?style=for-the-badge&logo=sqlite&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)

> **一个专为家庭 NAS 环境优化的独立部署 Web 系统，通过多智能体协作 (Multi-Agent) 自动生成媲美 Google Deep Research 的万字长文深度研究报告。**

## 🌟 项目简介

在 AI 时代，生成一篇几百字的文章轻而易举，但要让 AI 自动生成一篇 **10000 字以上、逻辑严密、数据详实、且不跑题**的深度行业研究报告，传统的单体 Prompt 或简单的 Dify/n8n 工作流往往力不从心。它们常常面临以下痛点：
- 💥 **内存溢出 (OOM)**：长文本生成极易撑爆上下文窗口或本地内存。
- 😵‍💫 **严重幻觉**：大模型在缺乏外部知识锚定时，极易“一本正经地胡说八道”。
- 🍝 **工作流配置繁琐**：在 Dify 等平台编排复杂的循环与条件判断，节点连线如蜘蛛网般难以维护。

**DeepResearch-NAS** 应运而生。它是一个开箱即用的独立 Web 应用，专为飞牛 OS 等家庭 NAS 环境设计，支持 IPv6 + DDNS 反代访问。只需输入一个课题，系统便会自动进行 **“深度检索 -> 分解大纲 -> 循环撰写单章 -> 审稿纠错 -> 合并排版”**，全自动交付高质量的 Markdown 报告。

---

## 🗺️ 系统架构图 (Architecture)

DeepResearch-NAS 采用高度解耦的多智能体 (Multi-Agent) 架构，以下是系统生成一份报告的完整生命周期：

```mermaid
graph TD
    User([👤 用户输入课题]) --> UI[🖥️ Web 交互界面]
    UI -->|提交任务| API[⚙️ 后端 API 调度器]
    
    subgraph 🧠 智能体协作网络 (Multi-Agent Workflow)
        API -->|1. 规划| Planner[🧭 Planner 规划师]
        Planner -->|生成 JSON 大纲| Loop((🔄 章节循环引擎))
        
        Loop -->|2. 检索当前章| Researcher[🕵️ Researcher 检索员]
        Researcher -->|Bocha API| Web[(🌐 互联网网页)]
        Web -->|Jina Reader 提取| RAG[🗃️ 向量化与 RAG 检索]
        
        RAG -->|Top-K 文本切片| Writer[✍️ Writer 撰稿人]
        RAG -->|图表图片| Vision[👁️ Vision 视觉解析]
        Vision -->|Markdown 表格| Writer
        
        Writer -->|生成初稿| Critic[🧐 Critic 审稿人]
        Critic -->|打回修改| Writer
        Critic -->|审核通过| Extractor[🧠 记忆提取器]
        
        Extractor -->|提取 150 字摘要| Loop
    end
    
    Loop -->|所有章节完成| Compiler[📦 Compiler 整合排版]
    Compiler -->|流式落盘| Disk[(💾 NAS 本地硬盘)]
    Compiler -->|同步| Feishu[📝 飞书文档]
    Compiler -->|通知| TG[📱 Telegram 机器人]
    
    API -.->|SSE 实时推送进度| UI
```

---

## ⚙️ 核心机制与机理 (Mechanisms & Principles)

本系统并非简单的“调一次 API 出一篇文章”，而是模拟了人类顶级研究团队的真实工作流：

### 1. 动态 RAG 与多跳检索 (Dynamic RAG & Multi-hop)
- **机制**：Researcher 拿到单章大纲后，会使用大模型生成 3-5 个不同的搜索词（Query），并发调用博查 (Bocha) API。
- **降噪**：获取到 URL 后，系统使用 Jina Reader 穿透网页，提取纯净文本，并剔除百家号、知乎等内容农场。
- **向量化**：将长网页切分为 1000 字的 Chunk，调用 `text-embedding-v3` 进行向量化，最后通过余弦相似度计算，只将最相关的 Top-K 切片喂给 Writer。

### 2. 视觉多模态解析 (Vision Integration)
- **机制**：在抓取网页时，如果发现包含数据图表（如财报截图、走势图），系统会自动调用 `qwen-vl-max` 视觉大模型。
- **效果**：VLM 会“看图说话”，将图片中的数据精准提取为 Markdown 表格，喂给 Writer，极大地增强了报告的数据详实度。

### 3. 对抗生成与自我修正 (Self-Correction Loop)
- **机制**：Writer 并非写完就算。初稿会立刻被送给 Critic（审稿人）。Critic 会拿着原始大纲进行比对。
- **效果**：如果 Critic 发现内容空洞、跑题或字数严重不足，会直接输出修改意见，强制 Writer 重新生成（最多重试 2 次），确保每一章都干货满满。

### 4. 记忆链条传递 (Memory Chain)
- **机制**：写到第 8 章时，大模型往往会忘记第 1 章写了什么。系统在每章定稿后，会额外调用一次 LLM，提取该章的 150 字核心摘要。
- **效果**：这些摘要会像“接力棒”一样，作为上下文传递给下一章的 Writer，确保整篇万字长文逻辑连贯、不割裂。

---

## ✨ 架构级优点与特色 (Architectural Advantages)

作为一款专为 NAS 打造的系统，我们在工程实现上进行了极致的优化：

- ⚡ **全异步任务与 SSE 流式反馈**：前端绝不阻塞等待。任务提交后立即返回，通过 Server-Sent Events (SSE) 实时向前端推送后端 Agent 的思考过程与执行日志（如：“正在触发多跳检索...”）。
- 🌊 **流式输出 (Streaming)**：全面引入流式输出机制，在生成大纲、撰写章节等耗时操作时，每隔 5 秒动态推送生成进度和文本探针，彻底告别“假死”焦虑。
- 💾 **防 OOM (内存溢出) 机制**：严禁在内存中一次性累积万字长文。系统采用 **Append 模式流式落盘**，写完一章即刻写入 Docker Volume，并主动清理上下文内存，确保在低配 NAS 上也能稳定运行。
- 🛡️ **节流防封与重试降级**：内置指数退避重试 (Exponential Backoff) 与 API 冷却休眠机制（章节之间强制休眠 15 秒）。即使遇到网络波动或 API 频率限制，也能保障长时间无人值守运行的绝对稳定。

---

## 🛑 独创的“四大防幻觉”防线

我们通过架构设计，将 AI 幻觉压制到最低：

1. **大纲锁死机制**：Planner 提前定好钢筋骨架，Writer 只能在单章的“沙盒”内发挥，从根本上限制了发散边界。
2. **事实锚定与多跳检索**：Writer 的生成必须基于 Researcher 检索回来的**真实网页切片**，而非依赖模型自身可能过时的预训练权重。
3. **审稿人自我博弈 (Self-Correction)**：Critic 与 Writer 形成对抗生成网络（GAN）的雏形。Critic 负责挑刺，Writer 负责修改，确保输出质量。
4. **动态上下文摘要**：通过传递高浓度的章节摘要，保持全局逻辑连贯，避免模型在长篇大论中“忘记初衷”。

---

## 📦 详细部署指南 (Deployment Guide)

系统采用 Docker Compose 一键部署，完美适配飞牛 OS、群晖、极空间等家庭 NAS 环境。

### 步骤 1：准备宿主机目录
在您的 NAS 上通过 SSH 或文件管理器创建一个专属目录，用于存放数据和配置文件：
```bash
mkdir -p /volume1/docker/deepresearch
cd /volume1/docker/deepresearch
```

### 步骤 2：创建 `docker-compose.yml`
在该目录下新建 `docker-compose.yml` 文件，并填入以下内容：

```yaml
version: '3.8'

services:
  deepresearch:
    image: ghcr.io/yourusername/deepresearch-nas:latest # 请替换为实际构建的镜像地址
    container_name: deepresearch-nas
    restart: unless-stopped
    ports:
      - "6789:3000" # 左侧 6789 为 NAS 暴露的端口，右侧 3000 为容器内端口，请勿修改右侧
    volumes:
      - ./data:/app/data       # 挂载 SQLite 数据库，确保重启不丢配置
      - ./reports:/app/reports # 挂载生成的 Markdown 和 HTML 报告
    environment:
      - NODE_ENV=production
      - TZ=Asia/Shanghai
```

### 步骤 3：一键启动服务
在终端中执行以下命令拉取镜像并启动容器：
```bash
docker-compose up -d
```
启动后，您可以通过 `docker logs -f deepresearch-nas` 查看启动日志，确认服务已成功运行在 3000 端口。

### 步骤 4：Web 初始化与配置
1. 打开浏览器，访问 `http://<您的NAS局域网IP>:6789`（如果您配置了 Lucky 反代，也可以通过外网域名访问）。
2. **首次进入**会触发 Web UI 初始化向导。
3. 设置一个**管理员密码**（用于后续登录控制台）。
4. 在设置页面填入必要的 API Keys：
   - **阿里云百炼 API Key**：用于驱动各个大模型 Agent。
   - **博查 (Bocha) API Key**：用于驱动 Researcher 进行全网深度检索。
5. 点击“保存”，系统会自动测试连通性。测试通过后，即可开始生成您的第一份深度报告！

---

## 💎 最佳模型配置推荐 (基于阿里云百炼)

系统支持为 5 大智能体**独立配置 API Key 与 Base URL**，完美绕过单一套餐的并发/Token 限制。以下是兼顾质量与成本的“最具性价比”配置清单：

| 智能体角色 | 推荐模型 | 配置理由 |
| :--- | :--- | :--- |
| **Planner (规划师)** | `qwen-max` | 负责定基调、搭骨架，必须用推理能力最强的模型。 |
| **Writer (撰稿人)** | `qwen-plus` | 负责干重活、大批量写字，长文本生成能力极佳，性价比之王。 |
| **Critic (审稿人)** | `qwen-plus` 或 `qwen-turbo` | 负责挑刺和总结。追求极致严谨用 plus，追求速度与低成本用 turbo。 |
| **Embedding (向量)**| `text-embedding-v3` | 负责文本向量化，固定使用此最新版。 |
| **Vision (视觉)** | `qwen-vl-max` | 负责看懂复杂数据图表，必须用最强视觉模型防误读。 |

> **💡 极客玩法**：您可以将 Planner 和 Writer 配置为阿里云的 API，而将 Critic 的独立 API 配置为 OpenAI 的 `gpt-4o`。利用异构模型的思维差异进行“交叉审查”，能进一步将幻觉率降至冰点！

---

## 🛠️ 高级特性与配置

### 1. 飞书文档自动同步
系统支持将生成的报告自动同步到飞书文档，方便团队协作与分享。
- 在设置中配置飞书的 `App ID` 和 `App Secret`。
- 开启同步功能后，系统会在报告生成完毕后自动创建飞书文档并追加内容。

### 2. Telegram 机器人通知
长时间运行的任务（通常 15-30 分钟）完成后，系统可以通过 Telegram 机器人向您发送通知。
- 在设置中配置 Telegram Bot Token 和您的 Chat ID。
- 任务开始、完成或报错时，您将第一时间收到消息，无需一直盯着屏幕。

### 3. 代理支持 (Proxy)
对于需要科学上网的环境，系统支持配置 HTTP/SOCKS 代理。
- 在设置中填入代理地址（如 `http://192.168.10.12:7890`）。
- 系统会自动为所有外部 API 请求（包括大模型调用和网页抓取）应用代理。

---

## ❓ 常见问题 (FAQ)

**Q: 为什么生成一章需要这么久？**
A: 为了保证报告的深度和质量，系统在生成每一章时都会进行：多词并发检索 -> 网页穿透下载 -> VLM 图表解析 -> 文本切片向量化 -> RAG 召回 -> 大模型撰写 -> 审稿人打回重写。这是一个极度计算密集型的过程，单章耗时 2-5 分钟属于正常现象。您可以查看终端日志了解实时进度。

**Q: 如何避免 API 频率限制 (Rate Limit)？**
A: 系统内置了指数退避重试和章节间的冷却休眠机制。如果您仍然遇到频率限制，建议：
1. 为不同的 Agent 配置不同的 API Key（系统支持独立配置）。
2. 升级您的 API 账户以获取更高的并发额度。

**Q: 生成的报告保存在哪里？**
A: 报告会以 Markdown 格式保存在您映射的 `./reports` 目录中。同时，系统也会生成一份同名的交互式 HTML 报告，方便您在浏览器中直接阅读或分享。

**Q: 外网通过 IPv6/DDNS 访问时，终端日志断连怎么办？**
A: 系统采用 Server-Sent Events (SSE) 推送日志，对反向代理比较敏感。如果您使用 Lucky 或 Nginx 反代，请确保开启了 `proxy_buffering off;` 和 `proxy_cache off;`，并将超时时间设置得足够长（如 3600s），以防止长连接被网关切断。

---

## 📄 License

MIT License © 2026
