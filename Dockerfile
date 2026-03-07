FROM node:22-alpine

# Install su-exec for privilege dropping, git for updates, and build tools for native modules
RUN apk add --no-cache su-exec git python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Copy entrypoint script and make it executable
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

# Use the entrypoint script to handle PUID/PGID
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npx", "tsx", "server.ts"]
