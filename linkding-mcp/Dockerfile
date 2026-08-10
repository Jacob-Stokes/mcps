FROM node:22-alpine AS build
WORKDIR /build
COPY mcp-common /build/mcp-common
RUN cd /build/mcp-common && npm install --no-audit --no-fund && npm run build
WORKDIR /build/linkding-mcp
COPY linkding-mcp/package.json linkding-mcp/tsconfig.json ./
RUN npm install --no-audit --no-fund --install-links
COPY linkding-mcp/src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tini curl
COPY --from=build /build/linkding-mcp/node_modules ./node_modules
COPY --from=build /build/linkding-mcp/dist ./dist
COPY linkding-mcp/package.json ./
ENV PORT=7010
EXPOSE 7010
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
