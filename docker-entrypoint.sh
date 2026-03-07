#!/bin/sh
set -e

# If PUID and PGID are set, we use su-exec to drop privileges
if [ -n "$PUID" ] && [ -n "$PGID" ]; then
    echo "Starting with PUID: $PUID and PGID: $PGID"
    
    # Create group if it doesn't exist
    if ! getent group fnos >/dev/null; then
        addgroup -g "$PGID" fnos
    fi
    
    # Create user if it doesn't exist
    if ! getent passwd fnos >/dev/null; then
        adduser -D -u "$PUID" -G fnos -s /bin/sh fnos
    fi
    
    # Ensure data directories exist and have correct permissions
    mkdir -p /app/data /app/reports /app/logs
    chown -R fnos:fnos /app/data /app/reports /app/logs
    
    # Execute the command as the fnos user
    exec su-exec fnos "$@"
else
    echo "PUID/PGID not set, running as root"
    mkdir -p /app/data /app/reports /app/logs
    exec "$@"
fi
