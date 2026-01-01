# 🔄 Sistema de Migración Automática - Simply Backend

## 📋 Descripción

Este sistema migra automáticamente la base de datos cada vez que se deploya el backend a App Runner.

**⚠️ IMPORTANTE:** Este sistema está diseñado para desarrollo. Una vez en producción estable, debe ser deshabilitado.

---

## ✨ Qué Hace el Sistema

Cada vez que App Runner deploya una nueva versión:

1. ✅ Verifica conexión a PostgreSQL
2. ✅ Ejecuta `prisma db push` (actualiza schema)
3. ✅ Genera Prisma Client
4. ✅ Verifica si existe admin@simply.com
5. ✅ Crea usuario admin si no existe
6. ✅ Verifica que todas las tablas estén creadas
7. ✅ Inicia el servidor

---

## 📊 Logs en App Runner

Vas a ver esto en los logs de App Runner:

```
═══════════════════════════════════════════
  Simply Backend - Auto Migration System
═══════════════════════════════════════════

ℹ DATABASE_URL configurada correctamente
✓ Conexión a base de datos exitosa
ℹ Creando backup de seguridad...
ℹ Ejecutando migración de schema...
⚠ Esto puede tomar unos segundos...
✓ Schema de base de datos actualizado
ℹ Generando Prisma Client...
✓ Prisma Client generado
ℹ Verificando usuario administrador inicial...
✓ Usuario administrador ya existe
ℹ Verificando estructura de base de datos...
✓ Base de datos inicializada con 15 tablas

═══════════════════════════════════════════
  Migración Completada Exitosamente
═══════════════════════════════════════════

✓ Schema: Actualizado
✓ Admin: Verificado
✓ Tablas: 15

ℹ Iniciando servidor...
```

---

## 🔒 Seguridad

### ¿Es Seguro?

**Durante Desarrollo:** ✅ Sí
- `prisma db push` es idempotente (se puede ejecutar múltiples veces)
- No borra datos existentes
- Solo agrega/modifica columnas necesarias
- `--accept-data-loss` está controlado

**En Producción:** ⚠️ Usar con precaución
- Una vez estable, deshabilitar auto-migración
- Usar migraciones manuales controladas
- Hacer backups antes de cambios de schema

---

## 🛑 Cómo Deshabilitar (Para Producción)

Cuando el sistema esté estable y en producción:

### Opción 1: Usar Dockerfile sin migración

Reemplazar en `Dockerfile`:
```dockerfile
# En vez de:
CMD ["./migrate-and-start.sh"]

# Usar:
CMD ["npm", "start"]
```

### Opción 2: Variable de entorno

Agregar en App Runner:
```
SKIP_AUTO_MIGRATION=true
```

Y actualizar `migrate-and-start.sh`:
```bash
if [ "$SKIP_AUTO_MIGRATION" = "true" ]; then
    log_info "Auto-migración deshabilitada"
    exec npm start
fi
```

---

## 🔧 Qué Migra Automáticamente

### Tablas

- ✅ `employees` - Empleados del backoffice
- ✅ `tickets` - Sistema de tickets
- ✅ `ticket_comments` - Comentarios de tickets
- ✅ `aria_conversations` - Conversaciones con Aria
- ✅ `users` - Usuarios de la app
- ✅ `leads` - Leads del landing
- ✅ `landing_submissions` - Formularios del landing
- ✅ `contact_messages` - Mensajes de contacto
- ✅ `calculator_simulations` - Simulaciones de inversión
- ✅ `newsletter_subscribers` - Suscriptores newsletter
- ✅ Y todas las demás...

### Usuario Admin Inicial

```
Email: admin@simply.com
Password: Admin123!
Rol: SUPER_ADMIN
```

Este usuario se crea SOLO si no existe. No se sobrescribe.

---

## 🐛 Troubleshooting

### Error: "DATABASE_URL no está configurada"

**Solución:** Configurar en App Runner:
1. Service → Configuration → Environment variables
2. Agregar: `DATABASE_URL`
3. Valor: `postgresql://USER:PASS@HOST:5432/simply`

### Error: "No se pudo conectar a la base de datos"

**Solución:**
1. Verificar que RDS esté running
2. Verificar Security Group permite conexión desde App Runner
3. Verificar credenciales en DATABASE_URL

### El servidor no inicia

**Verificar logs:**
1. App Runner → Service → Logs
2. Buscar mensajes de error en rojo (✗)
3. El script muestra exactamente dónde falló

---

## 📝 Para el Futuro

**Cuando estés en producción:**

1. **Deshabilitar auto-migración** (ver arriba)
2. **Hacer migraciones manuales:**
   ```bash
   npx prisma migrate dev --name descripcion_cambio
   npx prisma migrate deploy
   ```
3. **Siempre hacer backup antes de migrar**
4. **Usar sistema de CI/CD con tests antes de deploy**

---

## ✅ Ventajas Actuales

- ✅ No necesitás hacer nada manual
- ✅ Cada deploy actualiza la BD automáticamente
- ✅ Siempre tenés el schema correcto
- ✅ El admin se crea automáticamente
- ✅ Logs claros de qué pasó
- ✅ Falla rápido si hay problemas

---

## 🎯 Resumen

**Ahora:** Deploy → Migración automática → Servidor arranca
**Futuro (producción estable):** Deshabilitar y migrar manualmente

---

**¿Preguntas?** Revisá los logs en App Runner, todo está documentado ahí.
