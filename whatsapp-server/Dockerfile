FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install build dependencies including git for GitHub dependencies
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git && rm -rf /var/lib/apt/lists/*

# Copy package manifests
COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies for TypeScript compilation)
RUN npm install

# Copy source code and config
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript
RUN npm run build

# --- Production Stage ---
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Install runtime utilities
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git && rm -rf /var/lib/apt/lists/*

# Copy package manifests
COPY package.json package-lock.json* ./

# Install production dependencies only
RUN npm install --omit=dev

# Copy compiled JavaScript from builder
COPY --from=builder /app/dist ./dist

# Create folders for runtime sessions and temporary uploads
RUN mkdir -p /app/sessions /app/uploads

EXPOSE 4000

CMD ["node", "dist/index.js"]
