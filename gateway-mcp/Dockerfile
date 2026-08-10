FROM node:22-alpine AS build
WORKDIR /build/gateway-mcp
COPY gateway-mcp/package.json gateway-mcp/tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY gateway-mcp/src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=build /build/gateway-mcp/node_modules ./node_modules
COPY --from=build /build/gateway-mcp/dist ./dist
COPY gateway-mcp/package.json ./
# Default config dir — persisted via docker volume so toggles survive restart.
ENV GATEWAY_CONFIG_DIR=/data
VOLUME /data
ENV PORT=7000
EXPOSE 7000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
