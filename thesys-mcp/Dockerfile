FROM node:22-alpine AS build
WORKDIR /build

# Copy the sibling shared-code package and build it first so its dist/ exists
# when thesys-mcp resolves the file: dep.
COPY mcp-common /build/mcp-common
RUN cd /build/mcp-common && npm install --no-audit --no-fund && npm run build

# This service's source
WORKDIR /build/thesys-mcp
COPY thesys-mcp/package.json thesys-mcp/tsconfig.json ./
RUN npm install --no-audit --no-fund --install-links
COPY thesys-mcp/src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tini curl
COPY --from=build /build/thesys-mcp/node_modules ./node_modules
COPY --from=build /build/thesys-mcp/dist ./dist
COPY thesys-mcp/package.json ./
ENV PORT=7001
EXPOSE 7001
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
