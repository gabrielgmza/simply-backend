# Changelog - Simply Backend

## [2.1.1] - 2024-12-31

### ✨ Added
- **GET /api/backoffice/leads** - Listar leads con paginación, búsqueda y ordenamiento
  - Parámetros: page, limit, search, sortBy, order
  - Retorna: leads[], total, page, totalPages
- **GET /api/backoffice/leads/:id** - Obtener detalle de un lead específico
- **GET /api/backoffice/leads/export** - Exportar todos los leads a CSV
  - Incluye BOM para compatibilidad con Excel
  - Headers: ID, Nombre, Apellido, Email, Teléfono, Source, UTM, etc.

### 📝 Changed
- Actualizado README con nuevos endpoints
- Mejorado manejo de errores en todos los endpoints
- Agregado 404 handler con lista de rutas disponibles

### 🔧 Technical
- Mode 'insensitive' para búsquedas case-insensitive
- Paginación con skip/take
- CSV con encoding UTF-8 BOM

---

## [2.1.0] - 2024-12-30

### Initial Release
- Health check endpoint
- Backoffice auth (hardcoded admin)
- Users listing
- Landing endpoints (leads, contact, calculator, newsletter)
- Prisma ORM integration
- PostgreSQL database
- Deployed on AWS App Runner
