FROM node:20-alpine

WORKDIR /app

# tools needed to download + unpack the MCP binary
RUN apk add --no-cache curl jq tar

# Install Neo4j MCP binary from GitHub releases
RUN set -eux; \
  API="https://api.github.com/repos/neo4j/mcp/releases/latest"; \
  URL="$(curl -sSL "$API" | jq -r '.assets[].browser_download_url' | grep -i linux | head -n 1)"; \
  echo "Downloading neo4j-mcp from: $URL"; \
  curl -sSL "$URL" -o /tmp/neo4j-mcp-asset; \
  (tar -xf /tmp/neo4j-mcp-asset -C /tmp 2>/dev/null || true); \
  if [ -f /tmp/neo4j-mcp ]; then \
    install -m 0755 /tmp/neo4j-mcp /usr/local/bin/neo4j-mcp; \
  else \
    # if the asset is a raw binary, not a tar archive
    install -m 0755 /tmp/neo4j-mcp-asset /usr/local/bin/neo4j-mcp; \
  fi; \
  neo4j-mcp -v || true

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 4000
CMD ["npm", "run", "dev"]
