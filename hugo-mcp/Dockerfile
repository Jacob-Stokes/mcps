# Base on hugomods/hugo:exts rather than node:alpine — it already ships a
# musl/Alpine-compatible Hugo Extended binary (CGO+libsass, which is why
# a plain glibc release binary wouldn't just drop into an Alpine image)
# plus Node, so no separate glibc base or manual Hugo download is needed.
FROM hugomods/hugo:exts AS build
WORKDIR /build
COPY mcp-common /build/mcp-common
RUN cd /build/mcp-common && npm install --no-audit --no-fund && npm run build
WORKDIR /build/hugo-mcp
COPY hugo-mcp/package.json hugo-mcp/tsconfig.json ./
RUN npm install --no-audit --no-fund --install-links
COPY hugo-mcp/src ./src
RUN npm run build

FROM hugomods/hugo:exts
WORKDIR /app
RUN apk add --no-cache tini curl
COPY --from=build /build/hugo-mcp/node_modules ./node_modules
COPY --from=build /build/hugo-mcp/dist ./dist
COPY hugo-mcp/package.json ./
ENV PORT=7030
EXPOSE 7030
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
