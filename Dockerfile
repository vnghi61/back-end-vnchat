# syntax=docker/dockerfile:1
# Image chạy API + Socket.IO + việc nền (một process). Render build trực tiếp từ file này (render.yaml).
# Base pin theo digest: build lặp lại được, không bị đổi ngầm khi tag được trỏ sang bản khác.
ARG NODE_IMAGE=node:22.23.2-alpine3.24@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85

# ---- deps: chỉ dependency production, layer riêng để cache khi chỉ sửa source ----
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ---- runtime ----
FROM ${NODE_IMAGE} AS runtime
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    PORT=5001 \
    APP_VERSION=${APP_VERSION}
WORKDIR /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node api ./api

# user không phải root (có sẵn trong image node)
USER node
EXPOSE 5001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

STOPSIGNAL SIGTERM
CMD ["node", "src/index.js"]
