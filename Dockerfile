FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173

WORKDIR /app

RUN mkdir -p /app/.runtime && chown node:node /app/.runtime

COPY --chown=node:node package.json ./
COPY --chown=node:node server/ ./server/
COPY --chown=node:node dist/ ./dist/
COPY --chown=node:node scripts/healthcheck.mjs ./scripts/healthcheck.mjs

USER node

EXPOSE 4173

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "scripts/healthcheck.mjs"]

CMD ["node", "server/index.mjs"]
