FROM node:22-alpine AS build
WORKDIR /build
COPY mcp-common /build/mcp-common
RUN cd /build/mcp-common && npm install --no-audit --no-fund && npm run build
WORKDIR /build/freshrss-mcp
COPY freshrss-mcp/package.json freshrss-mcp/tsconfig.json ./
RUN npm install --no-audit --no-fund --install-links
COPY freshrss-mcp/src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tini curl
COPY --from=build /build/freshrss-mcp/node_modules ./node_modules
COPY --from=build /build/freshrss-mcp/dist ./dist
COPY freshrss-mcp/package.json ./
ENV PORT=7009
EXPOSE 7009
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
