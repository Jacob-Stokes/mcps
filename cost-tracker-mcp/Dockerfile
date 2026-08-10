FROM node:22-alpine AS build
WORKDIR /build

COPY mcp-common /build/mcp-common
RUN cd /build/mcp-common && npm install --no-audit --no-fund && npm run build

WORKDIR /build/cost-tracker-mcp
COPY cost-tracker-mcp/package.json cost-tracker-mcp/tsconfig.json ./
RUN npm install --no-audit --no-fund --install-links
COPY cost-tracker-mcp/src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tini curl
COPY --from=build /build/cost-tracker-mcp/node_modules ./node_modules
COPY --from=build /build/cost-tracker-mcp/dist ./dist
COPY cost-tracker-mcp/package.json ./
ENV PORT=7013
EXPOSE 7013
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
