# Custom playwright-mcp image: headed chromium rendered onto an Xvfb virtual
# display, served over VNC via x11vnc, wrapped in noVNC's web UI. Chrome runs
# as its own standalone, always-on process (not spawned/owned by
# playwright-mcp) so the browser session — tabs, logins, everything —
# persists across MCP connections instead of opening/closing per call.
# playwright-mcp just attaches to it via CDP. Supervised by supervisord so
# all six processes (xvfb, x11vnc, novnc-websockify, fluxbox, chrome,
# playwright-mcp) run together and restart if any dies.
#
# Exposed ports:
#   7004  — MCP streamable HTTP (internal-only, thesys-net)
#   8080  — noVNC web UI (goes through cloudflared, own tunnel hostname)

FROM mcr.microsoft.com/playwright:v1.55.0-noble

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb \
      x11vnc \
      novnc \
      websockify \
      supervisor \
      fluxbox \
      unzip \
    && rm -rf /var/lib/apt/lists/*

# uBlock Origin Lite (the MV3 rewrite — full uBlock Origin is MV2-only by
# design and Chrome no longer loads MV2 extensions at all, so the classic
# build silently failed to register here for a while). Bundled as an
# unpacked extension, loaded into every browser session via --load-extension
# so ads/trackers are blocked by default — keeps pages light and less
# distracting to watch over VNC.
ARG UBOL_VERSION=2026.812.1211
RUN curl -sSL -o /tmp/ubol.zip \
      "https://github.com/uBlockOrigin/uBOL-home/releases/download/${UBOL_VERSION}/uBOLite_${UBOL_VERSION}.chromium.zip" \
    && unzip -q /tmp/ubol.zip -d /opt/ublock-origin-files \
    && rm /tmp/ubol.zip

# "I still don't care about cookies" — community-maintained fork of the
# popular auto-accept-cookie-banners extension (the original was acquired by
# Avast). Also MV3. Loaded alongside uBOL above.
ARG IDCAC_VERSION=1.1.9
RUN curl -sSL -o /tmp/idcac.zip \
      "https://github.com/OhMyGuus/I-Still-Dont-Care-About-Cookies/releases/download/v${IDCAC_VERSION}/ISDCAC-chrome-source.zip" \
    && unzip -q /tmp/idcac.zip -d /opt/idcac \
    && rm /tmp/idcac.zip

# Install the MCP server globally so supervisord can just invoke `node` with
# the installed cli.js. Version pinned in a moment via package.json if needed.
RUN npm install -g @playwright/mcp@latest

# Chrome runs as its OWN standalone, always-on supervisor program (see
# supervisord.conf) rather than being spawned/owned by playwright-mcp —
# that's what makes the browser session persistent across MCP connections
# instead of closing after each one. playwright-mcp just attaches to it via
# --cdp-endpoint. Symlink to a stable path since the bundled chromium's
# version-numbered directory (e.g. chromium-1217) shifts on image rebuilds.
RUN ln -s "$(find /ms-playwright -maxdepth 3 -type f -name chrome -path '*chromium-*' | head -1)" /usr/local/bin/chrome-standalone

# Output dir needs to be writable; default tries /app/.playwright-mcp.
RUN mkdir -p /tmp/playwright-mcp && chmod 777 /tmp/playwright-mcp

# Browser data dir so sessions persist across restarts if we mount a volume.
RUN mkdir -p /data/browser && chmod 777 /data/browser

# noVNC ships vnc.html but no index.html, so websockify's --web serves a
# directory listing at /. Add a redirect so hitting the root auto-loads the
# client and connects immediately.
RUN printf '<!doctype html><meta http-equiv="refresh" content="0; url=vnc.html?autoconnect=true&resize=scale&path=websockify">\n' > /usr/share/novnc/index.html

# Supervisord config runs all processes + restarts any that die.
COPY playwright-mcp/supervisord.conf /etc/supervisor/conf.d/playwright.conf

EXPOSE 7004 8080
CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]
