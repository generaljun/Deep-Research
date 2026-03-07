#!/bin/sh
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
    
    # 1. 处理组 (Group)
    # 检查 GID 是否已被占用
    EXISTING_GROUP=$(getent group "$PGID" | cut -d: -f1)
    if [ -n "$EXISTING_GROUP" ]; then
        GROUP_NAME="$EXISTING_GROUP"
        echo "ℹ️  GID $PGID 已被组 [$GROUP_NAME] 占用，将复用该组"
    else
        GROUP_NAME="fnos"
        echo "➕ 创建新组: $GROUP_NAME (GID: $PGID)"
        addgroup -g "$PGID" "$GROUP_NAME"
    fi
    
    # 2. 处理用户 (User)
    # 检查 UID 是否已被占用
    EXISTING_USER=$(getent passwd "$PUID" | cut -d: -f1)
    if [ -n "$EXISTING_USER" ]; then
        USER_NAME="$EXISTING_USER"
        echo "ℹ️  UID $PUID 已被用户 [$USER_NAME] 占用，将复用该用户"
    else
        USER_NAME="fnos"
        echo "➕ 创建新用户: $USER_NAME (UID: $PUID)"
        adduser -D -u "$PUID" -G "$GROUP_NAME" -s /bin/sh "$USER_NAME"
    fi

    echo "📂 正在同步文件夹所有权 (chown)..."
    chown -R "$PUID:$PGID" /app/data /app/reports /app/logs
    
    echo "✅ 权限配置完成，切换用户 [$USER_NAME] 执行命令"
    exec su-exec "$USER_NAME" "$@"
else
    echo "⚠️  提示: 正在以 Root 身份运行"
    echo "📂 正在确保文件夹可写..."
    chmod -R 755 /app/data /app/reports /app/logs
    exec "$@"
fi
