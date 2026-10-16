FROM node:22-bookworm-slim

WORKDIR /app

# Slim dependency set — only the collaboration server's runtime deps, so the
# image never builds the desktop app's native modules.
COPY collaborations/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

COPY collaborations/server.mjs collaborations/security.mjs ./

ENV LATEXDO_COLLAB_HOST=0.0.0.0
ENV LATEXDO_COLLAB_PORT=8787
ENV LATEXDO_COLLAB_DATA_DIR=/data
# Enable explicitly only when a controlled proxy overwrites forwarded headers.
ENV LATEXDO_COLLAB_TRUST_PROXY=false

RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 8787

CMD ["node", "server.mjs"]
