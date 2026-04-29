FROM opensandbox/code-interpreter:v1.0.2

# Build from the repository root:
# docker build -t openwork-agent-runtime:latest -f service/docker/openwork-agent-runtime/Dockerfile .

ENV CLAUDE_BRIDGE_PORT=8787 \
    CLAUDE_BRIDGE_CWD=/workspace \
    CLAUDE_PERMISSION_MODE=bypassPermissions \
    CLAUDE_ALLOWED_TOOLS=Bash,Read,Write,Edit,Glob,Grep,LS \
    IS_SANDBOX=1

WORKDIR /opt/openwork-agent-bridge

COPY service/docker/openwork-agent-runtime/bridge/package.json service/docker/openwork-agent-runtime/bridge/package-lock.json ./
RUN npm ci --omit=dev

COPY service/docker/openwork-agent-runtime/bridge/bridge.mjs service/docker/openwork-agent-runtime/bridge/bridgePrompt.mjs ./
RUN chmod +x ./bridge.mjs && mkdir -p /workspace /etc/claude-code
COPY service/docker/openwork-agent-runtime/claude/CLAUDE.md /etc/claude-code/CLAUDE.md

COPY runtime/openwork-cli /opt/openwork-cli
RUN chmod +x /opt/openwork-cli/bin/openwork.js \
    && ln -sf /opt/openwork-cli/bin/openwork.js /usr/local/bin/openwork

EXPOSE 8787

ENTRYPOINT ["node", "/opt/openwork-agent-bridge/bridge.mjs"]
