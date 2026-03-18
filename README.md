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

## ⚙️ 核心架构与工作流 (Multi-Agent Workflow)

本系统内部由 **5 大智能体 (Agents)** 紧密协作，模拟人类顶级研究团队的工作流：

1. 🧭 **Planner (规划师)**：系统的“大脑”。负责理解课题，进行 MECE（相互独立、完全穷尽）原则的结构拆解，输出严格的 JSON 格式万字大纲。
2. 🕵️ **Researcher (检索员)**：结合博查 (Bocha) Web Search API 与 `text-embedding-v3` 向量检索。它会评估当前素材的“饱和度”，并在信息不足时触发**多跳检索 (Multi-hop)**，深挖长尾数据。
3. ✍️ **Writer (撰稿人)**：系统的“主笔”。基于单章大纲与 RAG 提取的真实网页切片，进行 1500-2000 字的单章长文本扩写。
4. 🧐 **Critic (审稿人)**：系统的“质检员”。负责事实核查、防跑题审查。如果发现 Writer 生成的内容空洞或偏离大纲，会直接打回并附带修改意见，强制重写。
5. 👁️ **Vision (视觉解析)**：多模态专家。当检索到包含复杂图表（如财报截图）的网页时，负责将其精准解析为 Markdown 表格数据。

---

## 🚀 架构级优势 (Architectural Advantages)

作为一款专为 NAS 打造的系统，我们在工程实现上进行了极致的优化：

- ⚡ **全异步任务与 SSE 流式反馈**：前端绝不阻塞等待。任务提交后立即返回，通过 Server-Sent Events (SSE) 实时向前端推送后端 Agent 的思考过程与执行日志（如：“正在触发多跳检索...”）。
- 💾 **防 OOM (内存溢出) 机制**：严禁在内存中一次性累积万字长文。系统采用 **Append 模式流式落盘**，写完一章即刻写入 Docker Volume，并主动清理上下文内存，确保在低配 NAS 上也能稳定运行。
- 🧠 **全局记忆摘要机制**：为防止长文本生成过程中的“注意力稀释 (Lost in the Middle)”，每章写完后，系统会提取 150 字的核心摘要传递给下一章，确保第 8 章依然记得第 1 章的论点。
- 🛡️ **节流防封与重试降级**：内置指数退避重试 (Exponential Backoff) 与 API 冷却休眠机制。即使遇到网络波动或 API 频率限制，也能保障长时间无人值守运行的绝对稳定。

---

## 🛑 独创的“四大防幻觉”防线

我们通过架构设计，将 AI 幻觉压制到最低：

1. **大纲锁死机制**：Planner 提前定好钢筋骨架，Writer 只能在单章的“沙盒”内发挥，从根本上限制了发散边界。
2. **事实锚定与多跳检索**：Writer 的生成必须基于 Researcher 检索回来的**真实网页切片**，而非依赖模型自身可能过时的预训练权重。
3. **审稿人自我博弈 (Self-Correction)**：Critic 与 Writer 形成对抗生成网络（GAN）的雏形。Critic 负责挑刺，Writer 负责修改，确保输出质量。
4. **动态上下文摘要**：通过传递高浓度的章节摘要，保持全局逻辑连贯，避免模型在长篇大论中“忘记初衷”。

---

## 📦 部署与使用引导

系统采用 Docker Compose 一键部署，完美适配家庭 NAS。

### 1. 准备 `docker-compose.yml`

创建一个目录并新建 `docker-compose.yml` 文件：

```yaml
version: '3.8'

services:
  deepresearch:
    image: ghcr.io/yourusername/deepresearch-nas:latest # 替换为实际镜像地址或自行 build
    container_name: deepresearch-nas
    restart: unless-stopped
    ports:
      - "6789:3000" # 左侧为 NAS 暴露的端口，右侧为容器内端口，请勿修改右侧
    volumes:
      - ./data:/app/data       # 挂载 SQLite 数据库
      - ./reports:/app/reports # 挂载生成的 Markdown 报告
    environment:
      - NODE_ENV=production
      - TZ=Asia/Shanghai
```

### 2. 启动服务

```bash
docker-compose up -d
```

### 3. 初始化向导

1. 浏览器访问 `http://<NAS_IP>:6789`。
2. 首次进入会触发 **Web UI 初始化向导**。
3. 设置管理员密码，并填入阿里云百炼 API Key 及博查 API Key。
4. 完成后即可进入中枢控制台，开始生成你的第一份深度报告！

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

> **💡 极客玩法**：你可以将 Planner 和 Writer 配置为阿里云的 API，而将 Critic 的独立 API 配置为 OpenAI 的 `gpt-4o`。利用异构模型的思维差异进行“交叉审查”，能进一步将幻觉率降至冰点！

---

## 📄 License

MIT License © 2026
