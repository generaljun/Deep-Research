# ✨ 深度报告生成AI助手 (Deep Research Web)

![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg)
![Docker](https://img.shields.io/badge/docker-supported-blue.svg)

这是一个专为高效能知识工作者、研究人员打造的轻量级全栈 Web 应用。它旨在替代 Dify+n8n 的繁琐配置，通过纯 Node.js 实现了**全异步大纲生成**与**后台防 OOM 循环拆分撰写**，能够自动联网检索、深度思考并生成万字长文研究报告。全新升级的简约二次元风格界面，带来更流畅舒适的使用体验。

本项目特别针对**家庭 NAS 环境（如飞牛 NAS）**进行了深度优化，确保在有限的硬件资源下，能够长时间稳定运行，不卡死、不崩溃。

---

## 📑 目录

- [核心特性](#-核心特性)
- [系统架构与运行逻辑](#-系统架构与运行逻辑)
- [部署指引 (Docker / NAS)](#-部署指引-docker--nas)
- [默认配置与初始化](#-默认配置与初始化)
- [常见错误代码与问题 (FAQ)](#-常见错误代码与问题-faq)
- [参与贡献](#-参与贡献)
- [开源协议](#-开源协议)

---

## 🌟 核心特性

- 🎨 **简约二次元风格**：全新设计的 UI 界面，采用清新的色彩搭配、毛玻璃特效和流畅的动画，提供极佳的视觉体验。
- 🔐 **安全认证系统**：内置用户登录、密码修改及基于角色的权限管理（Admin/User）。
- 🤖 **AI 深度驱动**：结合大语言模型（默认兼容 OpenAI 格式，如阿里通义千问）与博查（Bocha）搜索引擎，实现精准的联网检索与内容生成。
- 📝 **全异步流式生成**：前端触发后，后台开启异步静默线程，支持断网/锁屏生成。通过 Server-Sent Events (SSE) 实时推送执行日志。
- 🛡️ **防内存溢出 (OOM)**：采用流式追加写入本地文件系统，轻松应对万字长文，彻底解放算力。
- 🚦 **单任务全局排队机制**：系统级并发控制，同一时间仅允许一个报告生成任务运行，其他用户提交任务时会自动进入排队状态，并在前端醒目提示，防止 NAS 资源被瞬间榨干。
- ⚙️ **可视化管理后台**：小白友好的 Web UI，直接在页面上配置 API Key、模型参数及系统设置，无需修改代码。
- 📊 **本地日志与报告管理**：系统自动记录每次报告生成的详细日志，支持在线查看、下载 Markdown 报告和一键清除。
- 👥 **多用户管理与额度控制**：管理员可创建、删除用户，并为每个普通用户分配生成报告的额度。
- 📱 **多渠道消息推送**：支持 Telegram Bot 和飞书 Webhook 实时推送任务开始、报错及完成通知。

---

## 🏗️ 系统架构与运行逻辑

本项目采用 **前后端分离** 的单体架构，前端使用 React + Tailwind CSS，后端使用 Express.js + SQLite。

### 核心架构原则 (高可用与防卡死)

1. **全异步任务 (Asynchronous Processing)**：
   - 传统 HTTP 请求在处理 15-30 分钟的长任务时必定超时。本系统后端接收任务后，立即返回 `Task ID`，并在后台开启异步 Promise 链处理。
   - 引入了**全局任务队列**，确保同一时间只有一个重度任务在运行，保护 NAS CPU/内存。
2. **状态流式反馈 (Server-Sent Events - SSE)**：
   - 前端通过 SSE 长连接实时监听后端的执行日志（如：“正在规划大纲...”、“正在通过博查检索第一章...”）。即使刷新页面，也能重新连接并获取最新状态。
3. **文件流式落盘与内存释放 (Stream Writing & OOM Prevention)**：
   - **严禁在内存中累积万字长文！** 后台循环每写完一个章节，立即使用 `fs.appendFileSync` 追加写入 NAS 挂载的 Docker Volume (`reports/{task_id}.md`)。写完后主动清理该章的上下文变量，防止 V8 引擎内存溢出。
4. **节流防封与重试降级 (Throttling & Fallback)**：
   - 循环调用 LLM 和搜索引擎 API 时，内置了指数退避重试（Exponential Backoff，默认重试 3 次）。
   - 章节与章节之间强制加入 10-15 秒的 `sleep` 缓冲，防止触发服务商的 RPM/TPM 限制。即使某章彻底失败，也只会写入占位符，绝不中断全局任务。

### 深度研究认知工作流 (Agentic Workflow)

系统在后台执行以下四步核心逻辑：

1. **Planner (规划师)**：接收课题，通过多轮对话锚定边界后，输出结构化的 JSON 大纲（包含 5-8 个章节标题和核心意图）。内置能源行业特性 Prompt。
2. **Researcher (检索员)**：遍历大纲，为每章单独生成查询词，调用博查 API 获取相关网页文本。内置 Token 截断机制，过滤噪音。
3. **Writer (撰稿人)**：基于单章大纲 + 检索素材，调用 LLM 撰写 1500-2000 字的单章 Markdown 文本。
4. **Compiler (整合者)**：循环结束后，生成完整的 Markdown 报告，触发 Telegram/飞书的“完成通知”，并附带下载链接。

---

## 🚀 部署指引 (Docker / NAS)

本项目强烈推荐使用 Docker Compose 进行部署，完美适配飞牛 NAS 等家庭服务器环境。

### 1. 准备目录结构

在您的 NAS 或服务器上创建一个目录（例如 `/volume1/docker/deep-research`），并在其中创建以下文件和文件夹：

```bash
mkdir -p /volume1/docker/deep-research/{data,reports,logs}
cd /volume1/docker/deep-research
```

### 2. 编写 `docker-compose.yml`

在目录下创建 `docker-compose.yml` 文件：

```yaml
version: '3.8'
services:
  deep-research:
    # 如果您已将镜像推送到 Docker Hub，可以直接使用镜像名
    # image: your-dockerhub-username/deep-research-web:latest
    build: . # 如果在本地构建
    container_name: deep-research-web
    ports:
      - "3000:3000" # 宿主机端口:容器端口 (配合 Lucky 反代使用 6789 -> 3000)
    volumes:
      - ./data:/app/data       # SQLite 数据库存储目录
      - ./reports:/app/reports # 生成的 Markdown 报告存储目录
      - ./logs:/app/logs       # 系统运行日志存储目录
    environment:
      - NODE_ENV=production
      - TZ=Asia/Shanghai
    restart: unless-stopped
```

### 3. 启动服务

```bash
docker-compose up -d
```

### 4. 网络与反向代理建议 (Lucky / IPv6)

- **内网访问**：直接通过 `http://192.168.x.x:6789` 访问。
- **外网访问 (Lucky 反代)**：
  - 在 Lucky 中配置反向代理，将您的域名（如 `https://web.nas.yourdomain.com:6789`）映射到内网的 `192.168.x.x:6789`。
  - **关键配置**：由于系统重度依赖 SSE (Server-Sent Events) 进行长连接日志推送，请务必在 Lucky 或 Nginx 中**关闭该站点的缓冲 (Proxy Buffering)**，并**调大超时时间 (Timeout)**（建议设置 3600 秒），否则可能会遇到前端日志断连、不更新的问题。

---

## ⚙️ 默认配置与初始化

项目首次启动时，会自动在 `/app/data/database.sqlite` 创建数据库，并初始化默认数据。

### 默认管理员账号

- **用户名**: `admin`
- **密码**: `admin123`
- *(强烈建议首次登录后，立即在右上角点击用户名修改密码！)*

### 系统设置初始化

登录后，请务必前往 **“系统设置”** 页面完成以下配置，否则系统无法工作：

1. **大模型配置 (LLM)**：
   - **Base URL**: 兼容 OpenAI 格式的 API 地址（例如阿里百炼：`https://dashscope.aliyuncs.com/compatible-mode/v1`）
   - **API Key**: 您的模型 API Key。
   - **模型名称**: 例如 `qwen-plus` 或 `qwen-max`。
2. **搜索引擎配置 (Bocha)**：
   - **API Key**: 博查 Web Search API Key。
3. **通知配置 (可选)**：
   - 填写 Telegram Bot Token / Chat ID 或飞书 Webhook URL，以便在长任务完成时接收手机通知。

---

## 🛠️ 常见错误代码与问题 (FAQ)

| 错误模块 / 现象 | 错误代码 | 可能原因与解决方案 |
| :--- | :--- | :--- |
| **[登录模块]** 登录失败 | `401` | 账号或密码错误。 |
| **[核心调度模块]** 额度不足 | `403` | 普通用户的报告生成次数已用完，请联系管理员充值。 |
| **[核心调度模块]** 系统繁忙 | `409` | 当前有其他用户的报告正在生成，触发了全局排队机制，请稍后再试。 |
| **[检索模块]** 运行失败 | `401` | 博查 API Key 错误或已过期。 |
| **[大纲/撰写模块]** 运行失败 | `404` | 大模型 Base URL 填写错误（请检查是否遗漏了 `/v1`）。 |
| **[大纲/撰写模块]** 运行失败 | `429` | 大模型 API 触发了并发或速率限制。系统会自动重试，若持续失败请检查服务商额度。 |
| **[前端交互]** 日志不更新 | N/A | SSE 连接断开。请检查反向代理（如 Lucky/Nginx）是否开启了 proxy buffering 或超时时间过短。 |

---

## 🤝 参与贡献

欢迎提交 Issue 或 Pull Request 来改进本项目！无论是功能建议、Bug 修复还是界面优化，我们都非常期待。

---

## ⚖️ 开源协议

本项目采用 [MIT License](LICENSE) 开源。
