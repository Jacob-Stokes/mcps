FROM node:22-alpine AS build
WORKDIR /build
COPY mcp-common /build/mcp-common
RUN cd /build/mcp-common && npm install --no-audit --no-fund && npm run build
WORKDIR /build/gateway-admin-mcp
COPY gateway-admin-mcp/package.json gateway-admin-mcp/tsconfig.json ./
RUN npm install --no-audit --no-fund --install-links
COPY gateway-admin-mcp/src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tini curl
COPY --from=build /build/gateway-admin-mcp/node_modules ./node_modules
COPY --from=build /build/gateway-admin-mcp/dist ./dist
COPY gateway-admin-mcp/package.json ./
ENV PORT=7020
EXPOSE 7020
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
