FROM opensandbox/code-interpreter:v1.0.2

ENV CLAUDE_BRIDGE_PORT=8787 \
    CLAUDE_BRIDGE_CWD=/workspace \
    CLAUDE_PERMISSION_MODE=bypassPermissions \
    CLAUDE_ALLOWED_TOOLS=Bash,Read,Write,Edit,Glob,Grep,LS \
    IS_SANDBOX=1

WORKDIR /opt/openwork-agent-bridge

COPY bridge/package.json bridge/package-lock.json ./
RUN npm ci --omit=dev

COPY bridge/bridge.mjs ./bridge.mjs
RUN chmod +x ./bridge.mjs && mkdir -p /workspace

EXPOSE 8787

ENTRYPOINT ["node", "/opt/openwork-agent-bridge/bridge.mjs"]
