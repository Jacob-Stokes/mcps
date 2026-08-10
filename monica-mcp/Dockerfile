FROM node:22-alpine AS build
WORKDIR /build
COPY mcp-common /build/mcp-common
RUN cd /build/mcp-common && npm install --no-audit --no-fund && npm run build
WORKDIR /build/monica-mcp
COPY monica-mcp/package.json monica-mcp/tsconfig.json ./
RUN npm install --no-audit --no-fund --install-links
COPY monica-mcp/src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tini curl
COPY --from=build /build/monica-mcp/node_modules ./node_modules
COPY --from=build /build/monica-mcp/dist ./dist
COPY monica-mcp/package.json ./
ENV PORT=7011
EXPOSE 7011
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
