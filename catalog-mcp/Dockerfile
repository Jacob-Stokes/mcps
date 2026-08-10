FROM node:22-alpine AS build
WORKDIR /build

COPY mcp-common /build/mcp-common
RUN cd /build/mcp-common && npm install --no-audit --no-fund && npm run build

WORKDIR /build/catalog-mcp
COPY catalog-mcp/package.json catalog-mcp/tsconfig.json ./
RUN npm install --no-audit --no-fund --install-links
COPY catalog-mcp/src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tini curl
COPY --from=build /build/catalog-mcp/node_modules ./node_modules
COPY --from=build /build/catalog-mcp/dist ./dist
COPY catalog-mcp/package.json ./
ENV PORT=7003
EXPOSE 7003
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
