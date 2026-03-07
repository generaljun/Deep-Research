# 使用轻量级 Node.js 镜像
FROM node:20-slim

# 安装 SQLite 运行所需的依赖
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制 package.json 并安装依赖
COPY package*.json ./
RUN npm install

# 复制所有源代码
COPY . .

# 编译前端
RUN npm run build

# 暴露端口 (Host 模式下此指令仅作声明)
EXPOSE 3000

# 启动命令
CMD ["npm", "start"]
