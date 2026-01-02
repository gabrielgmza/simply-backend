# Changelog - Simply Backend

## [3.3.0] - 2025-01-02

### ✨ Phase 4: RBAC, Aria AI, Tickets, Providers

**RBAC/ABAC Granular:**
- Permisos por recurso:acción con condiciones ABAC
- Jerarquía de roles con herencia
- Historial de cambios de permisos

**Aria AI Agent:**
- Agente autónomo con 10+ herramientas ejecutables
- SafetyGuardrails, Circuit breaker, Rollback 72h
- Audit trail completo

**Doble Autorización (Maker-Checker):**
- Thresholds por monto (50K/200K/500K ARS)
- Workflow multi-step, expiración 24h

**Sesiones PCI DSS:**
- Timeout 15 min, rotación de tokens
- Historial de contraseñas, lockout, forzar cambio 90 días

**Sistema de Tickets:**
- Clasificación y auto-respuesta con Aria
- Escalación automática, SLA configurable

**Gestión de Proveedores:**
- BIND, didit, Stripe, BCRA, COELSA, Rapipago, Anthropic
- Health checks, webhooks, encriptación AES-256

---

## [3.2.0] - 2025-01-02

### ✨ Phase 2 & 3: Treasury, OTC, Fraud, Compliance

**Treasury Service:**
- Gestión completa de cajas internas
- 10 cuentas por defecto (Main, FCI, Fees, Penalties, OTC)
- Depósitos, retiros, transferencias entre cuentas
- Ajustes manuales con audit trail
- Conciliación de saldos
- Flujo de caja por período
- GET/POST /api/backoffice/treasury/*

**OTC Operations:**
- Cotizaciones en tiempo real (USD, USDT)
- Flujo completo: Crear → Aprobar → Ejecutar
- Spread y fees configurables
- Integración con Treasury
- GET/POST /api/backoffice/otc/*

**Fraud Detection:**
- Evaluación de riesgo en tiempo real (score 0-100)
- 7 factores de riesgo evaluados
- Alertas automáticas
- Blacklist de IPs
- Bloqueo automático para riesgo crítico
- GET/POST /api/backoffice/fraud/*

**Compliance Service:**
- Generación de ROS (Reporte Operación Sospechosa)
- Monitoreo de umbrales UIF ($600k ARS)
- Flujo de aprobación y envío
- Programación de revisiones
- Estado de compliance por usuario
- GET/POST /api/backoffice/compliance/*

**Database:**
- otc_operations (nuevo)
- fraud_alerts (nuevo)
- blacklisted_ips (nuevo)
- compliance_reports (nuevo)
- compliance_reviews (nuevo)
- risk_flags (actualizado con relaciones)
- internal_movements (actualizado)
- transactions (actualizado con tipos OTC)

---

## [3.1.0] - 2025-01-02

### ✨ Backoffice Phase 1: Financial Management

**System Settings:**
- Configuración centralizada del sistema
- Categorías: rates, limits, fees, features, operations, levels
- Historial de cambios con motivo
- Simulación de impacto antes de aplicar
- Valores por defecto auto-inicializados

**Investment Management (Backoffice):**
- Listado con filtros avanzados
- Estadísticas globales (AUM, returns)
- Creación manual de inversiones
- Liquidación forzada
- Ajuste de valor con recálculo de crédito
- Exportación CSV

**Financing Management (Backoffice):**
- Listado con métricas de riesgo (NPL)
- Pago manual de cuotas
- Condonación de penalizaciones
- Extensión de vencimientos
- Liquidación forzada
- Cuotas próximas a vencer

**User Detail View:**
- Perfil completo con resumen financiero
- Inversiones y financiaciones del usuario
- Bloqueo/desbloqueo con motivo
- Ajuste de límites
- Cambio de nivel
- Flags de riesgo manuales

**Audit Log System:**
- Log inmutable de todas las acciones
- Tracking de actor, recurso, datos
- Estadísticas por acción/recurso/estado
- Búsqueda avanzada

---

## [3.0.0] - 2025-01-01

### ✨ App API Complete

**Authentication:**
- Passkeys (FIDO2/WebAuthn)
- TOTP 2FA backup
- Registro con verificación email
- Recovery tokens

**Wallet:**
- Saldo multi-moneda (ARS, USD, USDT)
- CVU y Alias
- Historial de movimientos

**Transfers:**
- Transferencias por CVU/Alias
- Validación de motivos BCRA
- Límites diarios/mensuales

**Investments:**
- Crear inversión en FCI
- Rendimientos diarios (22.08% anual)
- Liquidación con validaciones

**Financings:**
- Solicitar financiación (15% del invertido)
- Cuotas 2-48 a 0% interés
- Pago de cuotas
- Penalización por mora (3%)

---

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
