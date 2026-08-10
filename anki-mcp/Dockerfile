FROM node:22-alpine AS build
WORKDIR /build

COPY mcp-common /build/mcp-common
RUN cd /build/mcp-common && npm install --no-audit --no-fund && npm run build

WORKDIR /build/anki-mcp
COPY anki-mcp/package.json anki-mcp/tsconfig.json ./
RUN npm install --no-audit --no-fund --install-links
COPY anki-mcp/src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tini curl
COPY --from=build /build/anki-mcp/node_modules ./node_modules
COPY --from=build /build/anki-mcp/dist ./dist
COPY anki-mcp/package.json ./
ENV PORT=7006
EXPOSE 7006
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
