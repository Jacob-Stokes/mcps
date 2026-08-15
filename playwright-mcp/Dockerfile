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

# uBlock Origin bundled as an unpacked extension. Loaded into every browser
# session via --load-extension so ads/trackers are blocked by default (incl.
# when playwright drives the browser — keeps pages light and less distracting
# to watch over VNC).
ARG UBO_VERSION=1.70.0
RUN curl -sSL -o /tmp/ublock.zip \
      "https://github.com/gorhill/uBlock/releases/download/${UBO_VERSION}/uBlock0_${UBO_VERSION}.chromium.zip" \
    && unzip -q /tmp/ublock.zip -d /opt \
    && mv /opt/uBlock0.chromium /opt/ublock-origin-files \
    && rm /tmp/ublock.zip

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
