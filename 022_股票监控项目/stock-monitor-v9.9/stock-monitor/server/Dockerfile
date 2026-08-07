# v9.65（V2-P2）：本地服务端 Docker 镜像（PG 由 docker-compose 提供）
# 用法：在 server/ 目录执行 docker build -t stock-monitor-server .
FROM node:20-alpine

WORKDIR /app

# 依赖层（利用缓存）
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# 源码层
COPY index.js db.js cron.js ./
COPY lib ./lib
COPY routes ./routes
COPY scripts ./scripts

ENV PORT=8080
EXPOSE 8080

# 需要 DATABASE_URL 环境变量（docker-compose 注入）
CMD ["node", "index.js"]
