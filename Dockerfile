FROM node:20-slim

WORKDIR /app

# Install dependencies (use npm ci when package-lock.json is present)
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=optional; else npm install --no-audit --no-fund; fi

# Copy source
COPY . .

# Build TypeScript artifacts
RUN npm run build

# LangGraph Studio API port
EXPOSE 2024

# Run LangGraph Studio (reads .env inside the container)
CMD ["npx", "@langchain/langgraph-cli", "dev"]


