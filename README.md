# Simply Backend v2.2.0

Backend API para Simply fintech platform con autenticación JWT, RBAC, gestión de empleados, tickets y Aria AI assistant.

## 🚀 Stack Tecnológico

* Node.js 20 + Express
* TypeScript 5
* PostgreSQL (AWS RDS)
* Prisma ORM
* JWT Authentication
* Bcrypt
* Claude API (Anthropic)

---

## 🔄 Sistema de Migración Automática

**⚠️ IMPORTANTE:** El backend ahora migra la base de datos automáticamente en cada deploy.

### Qué Hace

Cada vez que deployás a App Runner:
1. ✅ Verifica conexión a PostgreSQL
2. ✅ Actualiza schema con `prisma db push`
3. ✅ Crea usuario admin si no existe (admin@simply.com)
4. ✅ Verifica todas las tablas
5. ✅ Inicia el servidor

### Cómo Ver los Logs

1. AWS Console → App Runner → simply-backend
2. Logs → Application logs
3. Verás:

```bash
═══════════════════════════════════════════
  Simply Backend - Auto Migration System
═══════════════════════════════════════════

✓ Conexión a base de datos exitosa
✓ Schema de base de datos actualizado
✓ Usuario administrador verificado
✓ Base de datos inicializada con 15 tablas

Migración Completada Exitosamente
```

### Usuario Admin Inicial

Se crea automáticamente si no existe:
```
Email: admin@simply.com
Password: Admin123!
Rol: SUPER_ADMIN
```

### Deshabilitar en Producción

Cuando el sistema esté estable:
```bash
bash disable-auto-migration.sh
```

📖 **Documentación completa:** [MIGRACION_AUTOMATICA.md](MIGRACION_AUTOMATICA.md)

---

## ✨ Features v2.2.0

### Autenticación & Autorización
- JWT (access 8h + refresh 7d)
- Bcrypt (12 rounds)
- RBAC con 5 roles
- Middleware de permisos

### Endpoints Principales

**Auth (3):**
- `POST /api/backoffice/auth/login`
- `GET /api/backoffice/auth/me`
- `POST /api/backoffice/auth/logout`

**Employees (7):**
- `GET /api/backoffice/employees` - Lista con filtros
- `POST /api/backoffice/employees` - Crear
- `GET /api/backoffice/employees/:id` - Detalle
- `PUT /api/backoffice/employees/:id` - Actualizar
- `DELETE /api/backoffice/employees/:id` - Eliminar
- `PATCH /api/backoffice/employees/:id/password` - Cambiar password
- `GET /api/backoffice/employees/stats/overview` - Estadísticas

**Tickets (8):**
- `GET /api/backoffice/tickets` - Lista
- `POST /api/backoffice/tickets` - Crear
- `GET /api/backoffice/tickets/:id` - Detalle
- `PUT /api/backoffice/tickets/:id` - Actualizar
- `PATCH /api/backoffice/tickets/:id/assign` - Asignar
- `PATCH /api/backoffice/tickets/:id/status` - Cambiar estado
- `POST /api/backoffice/tickets/:id/comments` - Agregar comentario
- `GET /api/backoffice/tickets/stats/overview` - Estadísticas

**Aria AI (5):**
- `POST /api/backoffice/aria/chat` - Chat con Aria
- `GET /api/backoffice/aria/conversations` - Lista de conversaciones
- `GET /api/backoffice/aria/conversations/:id` - Detalle
- `DELETE /api/backoffice/aria/conversations/:id` - Eliminar
- `PATCH /api/backoffice/aria/conversations/:id` - Actualizar título

**Total: 31 endpoints**

---

## 🗄️ Base de Datos

### Tablas Principales

- `employees` - Empleados del backoffice
- `tickets` - Sistema de tickets
- `ticket_comments` - Comentarios
- `aria_conversations` - Conversaciones con IA
- `users` - Usuarios de la app
- `leads` - Leads del landing
- `landing_submissions` - Formularios
- `contact_messages` - Contacto
- `calculator_simulations` - Simulador
- `newsletter_subscribers` - Newsletter

### Roles RBAC

1. **SUPER_ADMIN** - Acceso total
2. **ADMIN** - Gestión de usuarios/empleados
3. **COMPLIANCE** - KYC y verificaciones
4. **CUSTOMER_SERVICE** - Soporte y tickets
5. **ANALYST** - Visualización y reportes

---

## 🚀 Deploy a AWS App Runner

### Configuración Requerida

**Variables de entorno:**
```bash
DATABASE_URL=postgresql://USER:PASS@HOST:5432/simply
JWT_SECRET=tu-secret-super-seguro
JWT_REFRESH_SECRET=tu-refresh-secret-super-seguro
ANTHROPIC_API_KEY=<your-anthropic-api-key-here>  # Para Aria AI
NODE_ENV=production
PORT=8080
```

### Proceso de Deploy

1. **Push a GitHub:**
   ```bash
   git add .
   git commit -m "Deploy v2.2.0"
   git push origin main
   ```

2. **App Runner auto-deploya:**
   - Detecta el push
   - Construye el Dockerfile
   - Ejecuta migración automática
   - Inicia el servidor

3. **Verificar:**
   ```bash
   curl https://TU-URL.awsapprunner.com/health
   ```

---

## 🧪 Testing

### Health Check
```bash
curl https://sbgndespfp.us-east-1.awsapprunner.com/health
```

### Login
```bash
curl -X POST https://sbgndespfp.us-east-1.awsapprunner.com/api/backoffice/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@simply.com","password":"Admin123!"}'
```

### Listar Empleados (con token)
```bash
curl https://sbgndespfp.us-east-1.awsapprunner.com/api/backoffice/employees \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Chat con Aria
```bash
curl -X POST https://sbgndespfp.us-east-1.awsapprunner.com/api/backoffice/aria/chat \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hola Aria"}'
```

---

## 📁 Estructura

```
src/
├── middleware/
│   └── auth.ts              # Auth + RBAC
├── services/
│   ├── authService.ts       # Login, logout
│   ├── employeeService.ts   # CRUD empleados
│   ├── ticketService.ts     # Gestión tickets
│   └── ariaService.ts       # Claude API
├── utils/
│   ├── jwt.ts               # JWT helpers
│   └── permissions.ts       # RBAC matrix
└── index.ts                 # Main server

prisma/
└── schema.prisma            # Database schema

migrate-and-start.sh         # Auto-migration script
```

---

## 🔒 Seguridad

- ✅ JWT con expiración
- ✅ Bcrypt 12 rounds
- ✅ RBAC granular
- ✅ Permission-based endpoints
- ✅ Soft delete
- ✅ Prevención auto-eliminación
- ✅ CORS configurado
- ✅ Helmet.js para headers

---

## 📝 Logs

El servidor loguea:
- ✅ Requests HTTP
- ✅ Errores de auth
- ✅ Migraciones de BD
- ✅ Inicio/shutdown
- ✅ Conexiones de BD

Acceder en App Runner → Logs

---

## 🔗 URLs

- **Production:** https://sbgndespfp.us-east-1.awsapprunner.com
- **Health:** https://sbgndespfp.us-east-1.awsapprunner.com/health
- **Database:** simply-db-beta.c6j64wqoyeaz.us-east-1.rds.amazonaws.com

---

## 📞 Troubleshooting

### Server no inicia
1. Verificar logs en App Runner
2. Verificar DATABASE_URL
3. Verificar que RDS esté running

### Migración falla
1. Ver logs del script de migración
2. Verificar permisos de RDS
3. Verificar Security Groups

### Aria no responde
1. Verificar ANTHROPIC_API_KEY
2. Verificar créditos en Anthropic Console
3. Ver logs de error

---

**Version:** 2.2.0  
**Developer:** Gabriel  
**Last Update:** 31 Diciembre 2024
