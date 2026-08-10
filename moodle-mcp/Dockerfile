FROM node:22-alpine AS build
WORKDIR /build

COPY mcp-common /build/mcp-common
RUN cd /build/mcp-common && npm install --no-audit --no-fund && npm run build

WORKDIR /build/moodle-mcp
COPY moodle-mcp/package.json moodle-mcp/tsconfig.json ./
RUN npm install --no-audit --no-fund --install-links
COPY moodle-mcp/src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tini curl
COPY --from=build /build/moodle-mcp/node_modules ./node_modules
COPY --from=build /build/moodle-mcp/dist ./dist
COPY moodle-mcp/package.json ./
ENV PORT=7014
EXPOSE 7014
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
