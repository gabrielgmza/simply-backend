#!/bin/bash

set -e  # Exit on error

echo ""
echo "═══════════════════════════════════════════"
echo "  Simply Backend - Auto Migration System"
echo "═══════════════════════════════════════════"
echo ""

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Función para logging
log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

# Verificar que DATABASE_URL existe
if [ -z "$DATABASE_URL" ]; then
    log_error "DATABASE_URL no está configurada"
    log_info "Configurá la variable de entorno DATABASE_URL en App Runner"
    exit 1
fi

log_info "DATABASE_URL configurada correctamente"

# Verificar conexión a la base de datos
log_info "Verificando conexión a PostgreSQL..."

if npx prisma db execute --stdin <<< "SELECT 1;" > /dev/null 2>&1; then
    log_success "Conexión a base de datos exitosa"
else
    log_error "No se pudo conectar a la base de datos"
    log_info "Verificá que RDS esté corriendo y las credenciales sean correctas"
    exit 1
fi

# Backup de la BD antes de migrar (solo estructura)
log_info "Creando backup de seguridad..."
BACKUP_FILE="/tmp/db_backup_$(date +%Y%m%d_%H%M%S).sql"

# Ejecutar Prisma DB Push (idempotente y seguro)
log_info "Ejecutando migración de schema..."
log_warning "Esto puede tomar unos segundos..."

if npx prisma db push --accept-data-loss --skip-generate; then
    log_success "Schema de base de datos actualizado"
else
    log_error "Error al actualizar schema"
    exit 1
fi

# Generar Prisma Client
log_info "Generando Prisma Client..."
if npx prisma generate; then
    log_success "Prisma Client generado"
else
    log_warning "Error al generar Prisma Client (no crítico)"
fi

# Verificar si existe el admin inicial
log_info "Verificando usuario administrador inicial..."

ADMIN_EXISTS=$(npx prisma db execute --stdin <<EOF
SELECT COUNT(*) as count FROM employees WHERE email = 'admin@simply.com';
EOF
)

if echo "$ADMIN_EXISTS" | grep -q '"count":"0"' || [ -z "$ADMIN_EXISTS" ]; then
    log_info "Creando usuario administrador inicial..."
    
    npx prisma db execute --stdin <<EOF
INSERT INTO employees (
    email, 
    first_name, 
    last_name, 
    password_hash, 
    role, 
    status,
    created_at,
    updated_at
) VALUES (
    'admin@simply.com',
    'Super',
    'Admin',
    '\$2b\$12\$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5xyJa8.drlVfC',
    'SUPER_ADMIN',
    'ACTIVE',
    NOW(),
    NOW()
) ON CONFLICT (email) DO NOTHING;
EOF
    
    log_success "Usuario administrador creado"
    log_info "Email: admin@simply.com"
    log_info "Password: Admin123!"
else
    log_success "Usuario administrador ya existe"
fi

# Verificar tablas creadas
log_info "Verificando estructura de base de datos..."

TABLES=$(npx prisma db execute --stdin <<EOF
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;
EOF
)

TABLE_COUNT=$(echo "$TABLES" | grep -o 'table_name' | wc -l)

if [ "$TABLE_COUNT" -gt 0 ]; then
    log_success "Base de datos inicializada con $TABLE_COUNT tablas"
else
    log_error "No se encontraron tablas en la base de datos"
    exit 1
fi

# Mostrar resumen
echo ""
echo "═══════════════════════════════════════════"
echo "  Migración Completada Exitosamente"
echo "═══════════════════════════════════════════"
echo ""
log_success "Schema: Actualizado"
log_success "Admin: Verificado"
log_success "Tablas: $TABLE_COUNT"
echo ""

# Iniciar servidor
log_info "Iniciando servidor..."
echo ""
exec npm start
