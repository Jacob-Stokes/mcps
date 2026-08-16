FROM node:22-alpine AS build
WORKDIR /build
COPY mcp-common /build/mcp-common
RUN cd /build/mcp-common && npm install --no-audit --no-fund && npm run build
WORKDIR /build/files-mcp
COPY files-mcp/package.json files-mcp/tsconfig.json ./
RUN npm install --no-audit --no-fund --install-links
COPY files-mcp/src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tini curl
COPY --from=build /build/files-mcp/node_modules ./node_modules
COPY --from=build /build/files-mcp/dist ./dist
COPY files-mcp/package.json ./
ENV PORT=7015
EXPOSE 7015
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
