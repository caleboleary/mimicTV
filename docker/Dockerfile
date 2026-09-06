# mimicTV: the service with the built app inside it. Needs ffmpeg for scanning and break analysis.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/core/package.json packages/core/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
ENV MIMICTV_DATA=/data PORT=8787 NODE_ENV=production
VOLUME ["/data"]
EXPOSE 8787
CMD ["npm", "start"]
