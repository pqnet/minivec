FROM docker.io/node:22-bookworm-slim as build
RUN corepack enable pnpm

WORKDIR /src

COPY package.json .
COPY pnpm-lock.yaml .
COPY nitro.config.ts .
COPY tsconfig.json .
COPY server server

RUN pnpm install
RUN pnpm run build

FROM docker.io/node:22-bookworm-slim
WORKDIR /app
COPY --from=build /src/.output/ .

ENV NODE_ENV=production
ENV NITRO_LOCAL_MODELS_BASE_DIR=/models/
ENV NITRO_LOCAL_MODELS_EMBED_MODEL_FILE=bge-m3-q8_0.gguf
ENV NITRO_LOCAL_MODELS_RANK_MODEL_FILE=bge-reranker-v2-m3-q8_0.gguf

CMD ["server/index.mjs"]