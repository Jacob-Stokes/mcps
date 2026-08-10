FROM node:22-alpine AS build
WORKDIR /build

COPY mcp-common /build/mcp-common
RUN cd /build/mcp-common && npm install --no-audit --no-fund && npm run build

WORKDIR /build/ntfy-mcp
COPY ntfy-mcp/package.json ntfy-mcp/tsconfig.json ./
RUN npm install --no-audit --no-fund --install-links
COPY ntfy-mcp/src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tini curl
COPY --from=build /build/ntfy-mcp/node_modules ./node_modules
COPY --from=build /build/ntfy-mcp/dist ./dist
COPY ntfy-mcp/package.json ./
ENV PORT=7005
EXPOSE 7005
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
