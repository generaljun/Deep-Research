#!/bin/sh
set -e

# 默认 PUID/PGID 如果未设置则设为 0 (root)
PUID=${PUID:-0}
PGID=${PGID:-0}

echo "------------------------------------------------"
echo "🚀 系统启动中..."
echo "👤 运行环境: PUID=$PUID, PGID=$PGID"

# 确保必要的目录存在
mkdir -p /app/data /app/reports /app/logs

if [ "$PUID" -ne 0 ]; then
    echo "🔐 检测到非 Root 运行请求，正在配置权限..."
    
    # 创建或更新组
    if ! getent group fnos >/dev/null; then
        addgroup -g "$PGID" fnos
    fi
    
    # 创建或更新用户
    if ! getent passwd fnos >/dev/null; then
        adduser -D -u "$PUID" -G fnos -s /bin/sh fnos
    fi

    echo "📂 正在同步文件夹所有权 (chown)..."
    chown -R "$PUID:$PGID" /app/data /app/reports /app/logs
    
    echo "✅ 权限配置完成，切换用户执行命令"
    exec su-exec fnos "$@"
else
    echo "⚠️  警告: 正在以 Root 身份运行（建议在 NAS 中设置 PUID/PGID）"
    echo "📂 正在确保文件夹可写..."
    chmod -R 755 /app/data /app/reports /app/logs
    exec "$@"
fi
