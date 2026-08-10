FROM node:22-alpine AS build
WORKDIR /build
COPY mcp-common /build/mcp-common
RUN cd /build/mcp-common && npm install --no-audit --no-fund && npm run build
WORKDIR /build/zotero-mcp
COPY zotero-mcp/package.json zotero-mcp/tsconfig.json ./
RUN npm install --no-audit --no-fund --install-links
COPY zotero-mcp/src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tini curl
COPY --from=build /build/zotero-mcp/node_modules ./node_modules
COPY --from=build /build/zotero-mcp/dist ./dist
COPY zotero-mcp/package.json ./
ENV PORT=7012
EXPOSE 7012
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
