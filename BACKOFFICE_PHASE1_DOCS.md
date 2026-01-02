# Simply Backoffice API - Phase 1

**Versión:** 3.1.0  
**Base URL:** `https://api.paysur.com/api/backoffice`  
**Autenticación:** Bearer Token (JWT para empleados)

---

## 📋 Módulos Phase 1

1. **System Settings** - Variables del sistema
2. **Investments Management** - Gestión de inversiones
3. **Financing Management** - Gestión de financiación
4. **User Details** - Vista completa de usuarios
5. **Audit Logs** - Registro de acciones

---

## ⚙️ System Settings

### GET /settings
Obtener todas las configuraciones agrupadas por categoría.

### GET /settings/category/:category
Obtener configuraciones de una categoría específica.
- Categorías: `rates`, `limits`, `fees`, `features`, `operations`, `levels`

### GET /settings/rates
Obtener tasas actuales del sistema.

**Response:**
```json
{
  "fciAnnualRate": 22.08,
  "fciDailyRate": 0.0605,
  "penaltyRate": 3,
  "financingPercentage": 15,
  "transferFeeRate": 0.5
}
```

### GET /settings/features
Obtener feature flags.

**Response:**
```json
{
  "investments": true,
  "financing": true,
  "transfers": true,
  "cards": false,
  "crypto": false
}
```

### PUT /settings/:key
Actualizar una configuración.

**Body:**
```json
{
  "value": "25.5",
  "reason": "Ajuste por condiciones de mercado"
}
```

### PUT /settings
Actualizar múltiples configuraciones.

**Body:**
```json
{
  "updates": [
    { "key": "rates.fci_annual_rate", "value": "25.5" },
    { "key": "limits.financing_percentage", "value": "20" }
  ],
  "reason": "Actualización trimestral"
}
```

### POST /settings/:key/simulate
Simular impacto de un cambio antes de aplicarlo.

**Body:**
```json
{
  "value": "25.5"
}
```

**Response:**
```json
{
  "key": "rates.fci_annual_rate",
  "currentValue": "22.08",
  "newValue": "25.5",
  "totalAffected": 5000000,
  "currentDailyReturns": 3027.4,
  "newDailyReturns": 3493.15,
  "dailyDifference": 465.75,
  "monthlyDifference": 13972.5
}
```

### GET /settings/history
Historial de cambios de configuración.

---

## 📈 Investments Management

### GET /investments
Listar inversiones con filtros.

**Query params:**
- `page`, `limit` - Paginación
- `status` - ACTIVE, LIQUIDATED, LIQUIDATED_BY_PENALTY
- `userId` - Filtrar por usuario
- `minAmount`, `maxAmount` - Rango de montos
- `dateFrom`, `dateTo` - Rango de fechas
- `sortBy`, `sortOrder` - Ordenamiento

### GET /investments/:id
Obtener detalle de inversión con rendimientos y financiaciones.

### GET /investments/stats/overview
Estadísticas globales de inversiones.

**Response:**
```json
{
  "overview": {
    "totalActive": 150,
    "totalLiquidated": 25,
    "totalInvested": 75000000,
    "totalCreditUsed": 8500000,
    "totalCreditLimit": 11250000,
    "totalReturnsGenerated": 1250000
  },
  "distribution": {
    "uniqueInvestors": 120,
    "avgPerUser": 625000
  }
}
```

### POST /investments
Crear inversión manual para un usuario.

**Body:**
```json
{
  "userId": "uuid",
  "amount": 100000,
  "reason": "Compensación por error del sistema"
}
```

### POST /investments/:id/liquidate
Liquidar inversión forzada.

**Body:**
```json
{
  "reason": "Solicitud del usuario por emergencia"
}
```

### PATCH /investments/:id/value
Ajustar valor de inversión.

**Body:**
```json
{
  "value": 105000,
  "reason": "Corrección de rendimientos no acreditados"
}
```

### GET /investments/export/csv
Exportar inversiones a CSV.

---

## 💳 Financing Management

### GET /financings
Listar financiaciones con filtros.

**Query params:**
- `page`, `limit` - Paginación
- `status` - ACTIVE, COMPLETED, DEFAULTED, LIQUIDATED
- `userId` - Filtrar por usuario
- `investmentId` - Filtrar por inversión
- `hasOverdue` - true/false (tiene cuotas vencidas)
- `minAmount`, `maxAmount` - Rango de montos
- `dateFrom`, `dateTo` - Rango de fechas

### GET /financings/:id
Obtener detalle de financiación con todas las cuotas.

### GET /financings/stats/overview
Estadísticas globales de financiaciones.

**Response:**
```json
{
  "overview": {
    "totalActive": 85,
    "totalCompleted": 40,
    "totalDefaulted": 5,
    "totalFinanced": 12750000,
    "totalDebt": 8500000,
    "totalPenalties": 125000
  },
  "risk": {
    "overdueInstallments": 12,
    "overdueAmount": 450000,
    "nplRatio": "3.53"
  }
}
```

### GET /financings/upcoming
Cuotas por vencer en los próximos N días.

**Query:** `?days=7`

### POST /financings/installments/:id/pay
Pagar cuota manualmente.

**Body:**
```json
{
  "reason": "Pago recibido en efectivo"
}
```

### POST /financings/:id/liquidate
Liquidar financiación forzada (con penalización).

**Body:**
```json
{
  "reason": "Usuario incontactable, mora > 90 días"
}
```

### POST /financings/installments/:id/waive
Condonar penalización de cuota.

**Body:**
```json
{
  "reason": "Gesto comercial por antigüedad del cliente"
}
```

### POST /financings/installments/:id/extend
Extender vencimiento de cuota.

**Body:**
```json
{
  "newDueDate": "2025-02-15",
  "reason": "Solicitud del usuario por viaje"
}
```

### GET /financings/export/csv
Exportar financiaciones a CSV.

---

## 👤 User Details

### GET /users/:id/full
Obtener perfil completo del usuario.

**Response:**
```json
{
  "user": { /* datos básicos */ },
  "account": {
    "cvu": "0000285000012345678901",
    "alias": "juan.perez.simply",
    "balance": 150000,
    "dailyLimit": 500000,
    "monthlyLimit": 5000000
  },
  "financialSummary": {
    "balance": 150000,
    "totalInvested": 500000,
    "totalReturns": 12500,
    "creditLimit": 75000,
    "creditUsed": 25000,
    "creditAvailable": 50000,
    "totalDebt": 25000,
    "netWorth": 625000
  },
  "investments": { /* lista */ },
  "financings": { /* lista */ },
  "cards": { /* lista */ },
  "security": {
    "passkeys": [...],
    "activeSessions": [...],
    "kycDocuments": [...]
  },
  "risk": {
    "flags": [...],
    "hasActiveFlags": false,
    "overdueInstallments": []
  }
}
```

### GET /users/:id/transactions
Historial de transacciones del usuario.

### POST /users/:id/block
Bloquear usuario.

**Body:**
```json
{
  "reason": "Actividad sospechosa detectada"
}
```

### POST /users/:id/unblock
Desbloquear usuario.

### PATCH /users/:id/limits
Ajustar límites de transferencia.

**Body:**
```json
{
  "dailyLimit": 1000000,
  "monthlyLimit": 10000000,
  "reason": "Cliente VIP upgrade"
}
```

### PATCH /users/:id/level
Cambiar nivel del usuario.

**Body:**
```json
{
  "level": "ORO",
  "reason": "Alcanzó mínimo de inversión"
}
```

### POST /users/:id/risk-flags
Agregar flag de riesgo.

**Body:**
```json
{
  "type": "high_volume",
  "severity": "medium",
  "description": "Volumen inusual de transferencias",
  "details": { "amount": 5000000, "period": "24h" }
}
```

### POST /risk-flags/:id/resolve
Resolver flag de riesgo.

**Body:**
```json
{
  "resolution": "Verificado con el cliente, actividad legítima"
}
```

### GET /users/:id/audit
Historial de auditoría del usuario.

---

## 📝 Audit Logs

### GET /audit
Obtener logs de auditoría con filtros.

**Query params:**
- `page`, `limit` - Paginación
- `actorType` - employee, user, system
- `actorId` - ID del actor
- `action` - create, update, delete, login, etc.
- `resource` - users, investments, financings, settings
- `resourceId` - ID del recurso
- `dateFrom`, `dateTo` - Rango de fechas
- `status` - success, failed, blocked

### GET /audit/stats
Estadísticas de auditoría.

**Response:**
```json
{
  "total": 1500,
  "byAction": [
    { "action": "update", "_count": 450 },
    { "action": "create", "_count": 300 }
  ],
  "byResource": [
    { "resource": "users", "_count": 500 },
    { "resource": "investments", "_count": 400 }
  ],
  "byStatus": [
    { "status": "success", "_count": 1480 },
    { "status": "failed", "_count": 20 }
  ]
}
```

### GET /audit/recent
Logs más recientes.

---

## 🔐 Permisos por Rol

| Permiso | SUPER_ADMIN | ADMIN | COMPLIANCE | CUSTOMER_SERVICE | ANALYST |
|---------|-------------|-------|------------|------------------|---------|
| settings:* | ✅ | ❌ | ❌ | ❌ | ❌ |
| settings:read | ✅ | ✅ | ✅ | ❌ | ✅ |
| investments:* | ✅ | ❌ | ❌ | ❌ | ❌ |
| investments:read | ✅ | ✅ | ✅ | ✅ | ✅ |
| investments:create | ✅ | ✅ | ❌ | ❌ | ❌ |
| financings:* | ✅ | ❌ | ❌ | ❌ | ❌ |
| financings:read | ✅ | ✅ | ✅ | ✅ | ✅ |
| financings:pay | ✅ | ✅ | ❌ | ✅ | ❌ |
| users:block | ✅ | ✅ | ✅ | ❌ | ❌ |
| users:risk | ✅ | ✅ | ✅ | ❌ | ❌ |
| audit:read | ✅ | ✅ | ✅ | ❌ | ✅ |

---

## 📊 Variables del Sistema (Defaults)

### Tasas
- `rates.fci_annual_rate` = 22.08%
- `rates.penalty_rate` = 3%

### Límites
- `limits.financing_percentage` = 15%
- `limits.financing_min_amount` = $1,000
- `limits.financing_max_installments` = 48
- `limits.investment_min_amount` = $1,000
- `limits.transfer_daily_default` = $500,000
- `limits.transfer_monthly_default` = $5,000,000

### Comisiones
- `fees.transfer_rate` = 0.5%
- `fees.card_physical_price` = $5,000

### Features
- `features.investments_enabled` = true
- `features.financing_enabled` = true
- `features.transfers_enabled` = true
- `features.cards_enabled` = false
- `features.crypto_enabled` = false

### Niveles
- `levels.plata_min` = $0
- `levels.oro_min` = $100,000
- `levels.black_min` = $500,000
- `levels.diamante_min` = $2,000,000
