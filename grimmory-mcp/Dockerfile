FROM node:22-alpine AS build
WORKDIR /build
COPY mcp-common /build/mcp-common
RUN cd /build/mcp-common && npm install --no-audit --no-fund && npm run build
WORKDIR /build/grimmory-mcp
COPY grimmory-mcp/package.json grimmory-mcp/tsconfig.json ./
RUN npm install --no-audit --no-fund --install-links
COPY grimmory-mcp/src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tini curl
COPY --from=build /build/grimmory-mcp/node_modules ./node_modules
COPY --from=build /build/grimmory-mcp/dist ./dist
COPY grimmory-mcp/package.json ./
ENV PORT=7007
EXPOSE 7007
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
