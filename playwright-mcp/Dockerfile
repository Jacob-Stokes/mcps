# Custom playwright-mcp image: upstream mcp + headed chromium rendered onto
# an Xvfb virtual display, served over VNC via x11vnc, wrapped in noVNC's
# web UI. Supervised by supervisord so all four processes (xvfb, x11vnc,
# novnc-websockify, playwright-mcp) run together.
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

# Playwright-mcp's --browser flag maps "chrome"/"chromium" to Google's
# "chrome-for-testing" build, which isn't shipped in the base image (it only
# includes the bundled chromium). Pre-install it so container start doesn't
# do a 280MB download on first navigate.
RUN npx -y @playwright/mcp install-browser chrome-for-testing

# Output dir needs to be writable; default tries /app/.playwright-mcp.
RUN mkdir -p /tmp/playwright-mcp && chmod 777 /tmp/playwright-mcp

# Browser data dir so sessions persist across restarts if we mount a volume.
RUN mkdir -p /data/browser && chmod 777 /data/browser

# noVNC ships vnc.html but no index.html, so websockify's --web serves a
# directory listing at /. Add a redirect so hitting the root auto-loads the
# client and connects immediately.
RUN printf '<!doctype html><meta http-equiv="refresh" content="0; url=vnc.html?autoconnect=true&resize=scale&path=websockify">\n' > /usr/share/novnc/index.html

# Playwright-mcp config: tells chromium to load the uBO extension. Passed to
# the MCP server via `--config /etc/playwright-mcp-config.json`.
RUN printf '%s\n' \
    '{' \
    '  "browser": {' \
    '    "browserName": "chromium",' \
    '    "launchOptions": {' \
    '      "args": [' \
    '        "--disable-extensions-except=/opt/ublock-origin-files",' \
    '        "--load-extension=/opt/ublock-origin-files"' \
    '      ]' \
    '    }' \
    '  }' \
    '}' > /etc/playwright-mcp-config.json

# Supervisord config runs all processes + restarts any that die.
COPY playwright-mcp/supervisord.conf /etc/supervisor/conf.d/playwright.conf

EXPOSE 7004 8080
CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]
