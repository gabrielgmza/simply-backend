#!/bin/bash

# Script para deshabilitar migración automática
# Usar cuando el sistema esté en producción estable

echo "🛑 Deshabilitando migración automática..."
echo ""

# Crear nuevo Dockerfile sin auto-migración
cat > Dockerfile.production << 'EOF'
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

# Expose port
EXPOSE 8080

# Start application (SIN auto-migración)
CMD ["npm", "start"]
EOF

echo "✅ Dockerfile.production creado"
echo ""
echo "📝 Próximos pasos:"
echo ""
echo "1. Hacer backup de la BD:"
echo "   pg_dump ... > backup.sql"
echo ""
echo "2. Reemplazar Dockerfile:"
echo "   mv Dockerfile Dockerfile.dev"
echo "   mv Dockerfile.production Dockerfile"
echo ""
echo "3. Commit y push:"
echo "   git add ."
echo "   git commit -m 'Deshabilitar auto-migración para producción'"
echo "   git push origin main"
echo ""
echo "4. Para migraciones futuras, usar:"
echo "   npx prisma migrate dev --name nombre_migracion"
echo "   npx prisma migrate deploy"
echo ""
echo "⚠️  IMPORTANTE: Asegurate de tener backup antes de cualquier migración"
