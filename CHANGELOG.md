# Changelog - Simply Backend

## [2.2.0] - 2024-12-31

### ✨ Added - AUTH + RBAC + EMPLOYEES + TICKETS + ARIA

**Autenticación Segura:**
- JWT con access + refresh tokens (8h + 7d)
- Bcrypt para passwords (12 rounds)
- POST /api/backoffice/auth/login
- GET /api/backoffice/auth/me
- POST /api/backoffice/auth/logout

**Sistema de Roles (RBAC):**
- 5 roles: SUPER_ADMIN, ADMIN, COMPLIANCE, CUSTOMER_SERVICE, ANALYST
- Matriz de permisos completa
- Middleware `requirePermission` y `requireRole`
- Wildcard support (employees:*)

**Gestión de Empleados:**
- GET /api/backoffice/employees
- POST /api/backoffice/employees
- GET /api/backoffice/employees/:id
- PUT /api/backoffice/employees/:id
- DELETE /api/backoffice/employees/:id
- PATCH /api/backoffice/employees/:id/password
- GET /api/backoffice/employees/stats/overview

**Sistema de Tickets:**
- GET /api/backoffice/tickets
- POST /api/backoffice/tickets
- GET /api/backoffice/tickets/:id
- PUT /api/backoffice/tickets/:id
- PATCH /api/backoffice/tickets/:id/assign
- PATCH /api/backoffice/tickets/:id/status
- POST /api/backoffice/tickets/:id/comments
- GET /api/backoffice/tickets/stats/overview

**Aria AI Assistant:**
- POST /api/backoffice/aria/chat
- GET /api/backoffice/aria/conversations
- GET /api/backoffice/aria/conversations/:id
- DELETE /api/backoffice/aria/conversations/:id
- PATCH /api/backoffice/aria/conversations/:id
- Integración con Claude API (claude-sonnet-4-20250514)

**Base de Datos:**
- employees (actualizada con password_hash, role, status)
- tickets (nueva)
- ticket_comments (nueva)
- aria_conversations (nueva)
- Enums: EmployeeRole, EmployeeStatus, TicketCategory, TicketPriority, TicketStatus

**Servicios:**
- src/services/authService.ts
- src/services/employeeService.ts
- src/services/ticketService.ts
- src/services/ariaService.ts

**Seguridad:**
- Auth middleware mejorado
- Permission-based access control
- Logs de accesos
- Prevención de auto-eliminación

### 📦 Dependencies
- jsonwebtoken@^9.0.2
- bcrypt@^5.1.1
- @anthropic-ai/sdk@^0.32.1

---

## [2.1.1] - 2024-12-31

### Added
- GET /api/backoffice/leads
- GET /api/backoffice/leads/:id
- GET /api/backoffice/leads/export/csv

---

## [2.1.0] - 2024-12-30

### Initial Release
- Health check endpoint
- Backoffice auth (hardcoded)
- Users listing
- Landing endpoints
- PostgreSQL + Prisma
- Deploy en AWS App Runner
