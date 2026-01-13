# Lucas Brain - Mastra AI Agent
# Self-hosted on Railway for reliability

FROM node:20-slim

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm ci --only=production=false

# Copy source
COPY . .

# Build the Mastra project
RUN npx mastra build

# Expose the default Mastra port
EXPOSE 4111

# Start the built Mastra server
CMD ["npx", "mastra", "start"]
