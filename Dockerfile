# Railway deployment Dockerfile — runs API + webmail frontend
FROM node:22-bookworm-slim

# Install pnpm
RUN npm install -g pnpm@11.10.0

# Set working directory
WORKDIR /app

# Copy project files
COPY . /app

# Install all dependencies (includes both API and webmail)
RUN pnpm install --frozen-lockfile

# Build API server
RUN cd artifacts/artifacts/api-server && pnpm run build

# Build webmail frontend
RUN cd artifacts/artifacts/webmail && pnpm run build

# Expose webmail port (Railway sets PORT)
EXPOSE 3000

# Start both servers
CMD ["bash", "start.sh"]