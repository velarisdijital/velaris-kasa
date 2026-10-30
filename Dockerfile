# VelarisKasa — bulut / sunucu kurulumu
# docker build -t velaris-kasa .   ·   docker run -p 4848:4848 -v velaris-data:/data velaris-kasa

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production TZ=Europe/Istanbul PORT=4848 HOST=0.0.0.0 VELARIS_DATA_DIR=/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/bridge ./bridge
COPY package.json ./
# Veri klasörü yetkisiz kullanıcıya ait olmalı (adlandırılmış birim bu sahipliği devralır)
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 4848
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:4848/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
