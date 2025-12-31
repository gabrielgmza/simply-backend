FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy prisma schema
COPY prisma ./prisma/

# Generate Prisma Client
RUN npx prisma generate

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Copy and prepare migration script
COPY migrate-and-start.sh .
RUN chmod +x migrate-and-start.sh

# Expose port
EXPOSE 8080

# Start with auto-migration
CMD ["./migrate-and-start.sh"]
