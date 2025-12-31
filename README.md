# Simply Backend API v2.2.0

Backend API para Simply fintech platform con autenticación real, RBAC y gestión de empleados.

## 🚀 Stack Tecnológico

* Node.js 20 LTS
* TypeScript 5
* Express 4
* Prisma ORM 5
* PostgreSQL 15
* JWT + bcrypt
* AWS App Runner

## ✨ Features v2.2.0

### Autenticación Real
- JWT (access + refresh tokens)
- Bcrypt passwords (12 rounds)
- Login/Logout seguro
- Session management

### RBAC (Role-Based Access Control)
- 5 roles: SUPER_ADMIN, ADMIN, COMPLIANCE, CUSTOMER_SERVICE, ANALYST
- Matriz de permisos
- Middleware de autorización
- Wildcard permissions

### Gestión de Empleados
- CRUD completo
- Filtros y búsqueda
- Cambio de password
- Soft delete
- Estadísticas

## 📊 Endpoints

### Auth
```
POST /api/backoffice/auth/login
GET  /api/backoffice/auth/me
POST /api/backoffice/auth/logout
```

### Employees (Requiere auth + permisos)
```
GET    /api/backoffice/employees
POST   /api/backoffice/employees
GET    /api/backoffice/employees/:id
PUT    /api/backoffice/employees/:id
DELETE /api/backoffice/employees/:id
PATCH  /api/backoffice/employees/:id/password
GET    /api/backoffice/employees/stats/overview
```

### Users, Leads, Landing
*(Sin cambios desde v2.1.1)*

## 🔐 Permisos por Rol

| Rol | Permisos |
|-----|----------|
| SUPER_ADMIN | employees:*, users:*, leads:*, tickets:*, settings:*, aria:use |
| ADMIN | employees:read, users:*, leads:*, tickets:*, aria:use |
| COMPLIANCE | users:read, users:update:kyc, leads:read, tickets:read/create |
| CUSTOMER_SERVICE | users:read, leads:read, tickets:* |
| ANALYST | users:read, leads:read, leads:export, tickets:read |

## 🛠️ Setup

### 1. Instalar dependencias
```bash
npm install
```

### 2. Configurar variables de entorno
```bash
DATABASE_URL=postgresql://user:password@host:5432/simply
JWT_SECRET=your-jwt-secret-key
JWT_REFRESH_SECRET=your-refresh-secret-key
PORT=8080
NODE_ENV=production
```

### 3. Migrar base de datos
```bash
npx prisma db push
```

### 4. Crear primer SUPER_ADMIN
```sql
INSERT INTO employees (id, email, first_name, last_name, password_hash, role, status, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'admin@simply.com',
  'Super',
  'Admin',
  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5koSni66y08K2', -- Admin123!
  'SUPER_ADMIN',
  'ACTIVE',
  NOW(),
  NOW()
);
```

### 5. Iniciar servidor
```bash
npm run dev    # Development
npm run build  # Production build
npm start      # Production
```

## 🧪 Testing

```bash
# Login
curl -X POST http://localhost:8080/api/backoffice/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@simply.com","password":"Admin123!"}'

# Get current user
curl http://localhost:8080/api/backoffice/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN"

# List employees
curl http://localhost:8080/api/backoffice/employees \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 📁 Estructura

```
src/
├── middleware/
│   └── auth.ts           # Auth + RBAC middleware
├── services/
│   ├── authService.ts    # Login, register, password
│   └── employeeService.ts # CRUD empleados
├── utils/
│   ├── jwt.ts            # JWT helpers
│   └── permissions.ts    # RBAC matriz
└── index.ts              # Main server
```

## 🔗 URLs

**Production:** https://sbgndespfp.us-east-1.awsapprunner.com  
**Database:** simply-db-beta.c6j64wqoyeaz.us-east-1.rds.amazonaws.com

## 📝 Próximas Features (Entrega 2)

- Sistema de Tickets
- Aria (AI Assistant con Claude API)
- Perfil de empleado
- Dashboard stats avanzado

## 📞 Contacto

**Developer:** Gabriel  
**Email:** dev@paysur.com.ar  
**Version:** 2.2.0
