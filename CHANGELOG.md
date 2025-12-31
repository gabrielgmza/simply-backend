# Changelog - Simply Backend

## [2.2.0] - 2024-12-31

### ✨ Added - AUTH REAL + RBAC + EMPLOYEES

**Autenticación Segura:**
- JWT con access + refresh tokens (8h + 7d)
- Bcrypt para passwords (12 rounds)
- POST /api/backoffice/auth/login
- GET /api/backoffice/auth/me
- POST /api/backoffice/auth/logout

**Sistema de Roles (RBAC):**
- 5 roles: SUPER_ADMIN, ADMIN, COMPLIANCE, CUSTOMER_SERVICE, ANALYST
- Matriz de permisos completa
- Middleware `requirePermission`
- Middleware `requireRole`
- Wildcard support (employees:*)

**Gestión de Empleados:**
- GET /api/backoffice/employees - Lista con paginación y filtros
- POST /api/backoffice/employees - Crear empleado
- GET /api/backoffice/employees/:id - Detalle
- PUT /api/backoffice/employees/:id - Actualizar
- DELETE /api/backoffice/employees/:id - Soft delete
- PATCH /api/backoffice/employees/:id/password - Cambiar password
- GET /api/backoffice/employees/stats/overview - Estadísticas

**Base de Datos:**
- Tabla `employees` actualizada con password_hash, role, status, preferences
- Enums: EmployeeRole, EmployeeStatus
- Tabla `tickets` (para Entrega 2)
- Tabla `ticket_comments` (para Entrega 2)
- Tabla `aria_conversations` (para Entrega 2)

**Seguridad:**
- Auth middleware mejorado
- Permission-based access control
- Rate limiting (futuro)
- Logs de accesos
- Prevención de auto-eliminación

### 🔧 Changed
- Migración de auth hardcoded a JWT real
- Endpoints protegidos con RBAC
- Estructura modular (routes/, middleware/, services/, utils/)

### 📦 Dependencies
- jsonwebtoken@^9.0.2
- bcrypt@^5.1.1
- @anthropic-ai/sdk@^0.32.1 (preparado para Aria)

---

## [2.1.1] - 2024-12-31

### Added
- GET /api/backoffice/leads - Listar leads con paginación
- GET /api/backoffice/leads/:id - Detalle de lead
- GET /api/backoffice/leads/export/csv - Export CSV

### Changed
- README actualizado
- Mejorado manejo de errores

---

## [2.1.0] - 2024-12-30

### Initial Release
- Health check endpoint
- Backoffice auth (hardcoded)
- Users listing
- Landing endpoints
- PostgreSQL + Prisma
- Deploy en AWS App Runner
