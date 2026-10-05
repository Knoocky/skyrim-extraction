# Core service only. No game data, UI server, SkyMP binaries or production key.
FROM node:24.19.0-bookworm-slim
WORKDIR /app
RUN mkdir /app/data && chown node:node /app/data
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
USER node
ENV EXTRACTION_BIND=0.0.0.0
EXPOSE 8787
HEALTHCHECK --interval=5s --timeout=8s --start-period=10s --retries=3 CMD ["node", "scripts/health.ts"]
CMD ["node", "scripts/serve.ts"]
