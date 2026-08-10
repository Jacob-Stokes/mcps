FROM node:22-alpine AS build
WORKDIR /build

COPY mcp-common /build/mcp-common
RUN cd /build/mcp-common && npm install --no-audit --no-fund && npm run build

WORKDIR /build/obsidian-mcp
COPY obsidian-mcp/package.json obsidian-mcp/tsconfig.json ./
RUN npm install --no-audit --no-fund --install-links
COPY obsidian-mcp/src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tini curl
COPY --from=build /build/obsidian-mcp/node_modules ./node_modules
COPY --from=build /build/obsidian-mcp/dist ./dist
COPY obsidian-mcp/package.json ./
ENV PORT=7002
EXPOSE 7002
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
