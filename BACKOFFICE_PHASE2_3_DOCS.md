# Simply Backend API - Phase 2 & 3 Documentation

## Version: 3.2.0

---

## Phase 2: Treasury & OTC

### Treasury (Gestión de Cajas Internas)

Base URL: `/api/backoffice/treasury`

#### Endpoints

| Method | Endpoint | Descripción | Permiso |
|--------|----------|-------------|---------|
| GET | /accounts | Listar cuentas internas | treasury:read |
| GET | /accounts/:id | Detalle de cuenta | treasury:read |
| GET | /accounts/:id/movements | Movimientos de cuenta | treasury:read |
| POST | /accounts | Crear cuenta | treasury:create |
| POST | /deposit | Depositar | treasury:operate |
| POST | /withdraw | Retirar | treasury:operate |
| POST | /transfer | Transferir entre cuentas | treasury:operate |
| POST | /adjust | Ajuste de saldo | treasury:adjust |
| GET | /summary | Resumen de tesorería | treasury:read |
| GET | /cashflow | Flujo de caja | treasury:read |
| POST | /reconcile | Conciliación | treasury:reconcile |

#### Cuentas por Defecto

```
- Caja Principal ARS (main)
- Caja Principal USD (main)
- Caja Principal USDT (main)
- Caja FCI ARS (fci)
- Caja Comisiones ARS (fees)
- Caja Comisiones USD (fees)
- Caja Penalizaciones ARS (penalties)
- Caja OTC ARS (otc)
- Caja OTC USD (otc)
- Caja OTC USDT (otc)
```

#### Ejemplo: Depositar

```bash
POST /api/backoffice/treasury/deposit
{
  "accountId": "uuid-cuenta",
  "amount": 100000,
  "description": "Depósito inicial",
  "reference": "REF-001"
}
```

#### Ejemplo: Transferir entre cuentas

```bash
POST /api/backoffice/treasury/transfer
{
  "fromAccountId": "uuid-origen",
  "toAccountId": "uuid-destino",
  "amount": 50000,
  "description": "Transferencia operativa"
}
```

---

### OTC (Operaciones Over-The-Counter)

Base URL: `/api/backoffice/otc`

#### Endpoints

| Method | Endpoint | Descripción | Permiso |
|--------|----------|-------------|---------|
| GET | /rates | Cotizaciones actuales | otc:read |
| POST | /quote | Obtener cotización | otc:read |
| GET | /operations | Listar operaciones | otc:read |
| POST | /operations | Crear operación | otc:create |
| POST | /operations/:id/approve | Aprobar operación | otc:approve |
| POST | /operations/:id/execute | Ejecutar operación | otc:execute |
| POST | /operations/:id/reject | Rechazar operación | otc:approve |
| GET | /stats | Estadísticas | otc:read |

#### Assets Soportados

- USD (Dólar estadounidense)
- USDT (Tether)

#### Flujo de Operación

1. **Crear**: Usuario o empleado crea operación
2. **Aprobar**: Compliance aprueba
3. **Ejecutar**: Se ejecuta el intercambio
4. **Completado**: Fondos transferidos

#### Ejemplo: Obtener cotización

```bash
POST /api/backoffice/otc/quote
{
  "asset": "USD",
  "type": "BUY",
  "amount": 1000
}

Response:
{
  "asset": "USD",
  "type": "BUY",
  "amount": 1000,
  "rate": 1071,
  "totalARS": 1071000,
  "fee": 5355,
  "netAmount": 1076355,
  "validUntil": "2025-01-02T01:00:00Z"
}
```

---

## Phase 3: Fraud Detection & Compliance

### Fraud Detection (Detección de Fraude)

Base URL: `/api/backoffice/fraud`

#### Endpoints

| Method | Endpoint | Descripción | Permiso |
|--------|----------|-------------|---------|
| GET | /alerts | Listar alertas | fraud:read |
| POST | /alerts/:id/review | Revisar alerta | fraud:review |
| GET | /stats | Estadísticas | fraud:read |
| POST | /blacklist/ip | Agregar IP a lista negra | fraud:manage |
| DELETE | /blacklist/ip/:ip | Remover IP de lista negra | fraud:manage |

#### Niveles de Riesgo

- **LOW** (0-39): Sin acción requerida
- **MEDIUM** (40-59): Monitoreo
- **HIGH** (60-79): Requiere revisión
- **CRITICAL** (80-100): Bloqueo automático

#### Factores de Riesgo Evaluados

1. **HIGH_AMOUNT**: Monto inusual respecto al histórico
2. **VELOCITY_BREACH**: Muchas transacciones en poco tiempo
3. **UNUSUAL_PATTERN**: Patrones sospechosos (smurfing, etc.)
4. **SUSPICIOUS_IP**: IP en lista negra o nueva
5. **NEW_DEVICE**: Dispositivo no reconocido
6. **RECIPIENT_RISK**: Destinatario con flags de riesgo
7. **TIME_ANOMALY**: Horario inusual

#### Estados de Alerta

- **PENDING**: Pendiente de revisión
- **REVIEWING**: En revisión
- **RESOLVED**: Resuelta (sin fraude)
- **ESCALATED**: Escalada (fraude confirmado)
- **FALSE_POSITIVE**: Falso positivo

#### Ejemplo: Revisar alerta

```bash
POST /api/backoffice/fraud/alerts/uuid/review
{
  "resolution": "RESOLVED",
  "notes": "Transacción verificada con el usuario"
}
```

---

### Compliance (Reportes UIF)

Base URL: `/api/backoffice/compliance`

#### Endpoints

| Method | Endpoint | Descripción | Permiso |
|--------|----------|-------------|---------|
| GET | /reports | Listar reportes | compliance:read |
| POST | /reports/ros | Generar ROS | compliance:create |
| POST | /reports/:id/approve | Aprobar reporte | compliance:approve |
| POST | /reports/:id/submit | Enviar a UIF | compliance:submit |
| GET | /thresholds | Verificar umbrales | compliance:read |
| GET | /users/:id/status | Estado de compliance del usuario | compliance:read |
| POST | /reviews | Programar revisión | compliance:create |
| GET | /reviews/pending | Revisiones pendientes | compliance:read |
| GET | /stats | Estadísticas | compliance:read |

#### Tipos de Reporte

- **ROS**: Reporte de Operación Sospechosa
- **ROE**: Reporte de Operación Especial (no implementado)
- **THRESHOLD**: Operación que supera umbral
- **PERIODIC**: Reporte periódico

#### Estados de Reporte

- **DRAFT**: Borrador
- **PENDING_REVIEW**: Pendiente de aprobación
- **APPROVED**: Aprobado
- **SUBMITTED**: Enviado a UIF
- **REJECTED**: Rechazado

#### Umbral UIF

Operaciones ≥ $600,000 ARS requieren reporte automático.

#### Ejemplo: Generar ROS

```bash
POST /api/backoffice/compliance/reports/ros
{
  "userId": "uuid-usuario",
  "transactionIds": ["tx1", "tx2"],
  "type": "SMURFING",
  "description": "Fraccionamiento de operaciones detectado",
  "amount": 500000,
  "indicators": ["multiple_small_tx", "same_day", "round_amounts"]
}
```

---

## Permisos Nuevos

```typescript
// Treasury
'treasury:read'
'treasury:create'
'treasury:operate'
'treasury:adjust'
'treasury:reconcile'
'treasury:*'

// OTC
'otc:read'
'otc:create'
'otc:approve'
'otc:execute'
'otc:*'

// Fraud
'fraud:read'
'fraud:review'
'fraud:manage'
'fraud:*'

// Compliance
'compliance:read'
'compliance:create'
'compliance:approve'
'compliance:submit'
'compliance:*'
```

## Matriz de Roles Actualizada

| Rol | Treasury | OTC | Fraud | Compliance |
|-----|----------|-----|-------|------------|
| SUPER_ADMIN | ✓ Full | ✓ Full | ✓ Full | ✓ Full |
| ADMIN | ✓ Read/Operate | ✓ Read/Create | ✓ Read | ✓ Read |
| COMPLIANCE | ✓ Read | ✓ Read/Approve | ✓ Full | ✓ Full |
| CUSTOMER_SERVICE | ✗ | ✓ Read | ✓ Read | ✗ |
| ANALYST | ✓ Read | ✓ Read | ✓ Read | ✓ Read |

---

## Modelos de Base de Datos Nuevos

```prisma
// OTC
model otc_operations {
  id, user_id, type, asset, amount, rate, total_ars, fee, status
  created_by, approved_by, executed_by, rejected_by
  timestamps
}

// Fraud
model fraud_alerts {
  id, user_id, transaction_id, risk_score, risk_level, factors
  status, auto_blocked, reviewed_by, notes
  timestamps
}

model blacklisted_ips {
  id, ip, reason, added_by
  timestamps
}

// Compliance
model compliance_reports {
  id, type, user_id, status, content, transaction_ids, amount
  created_by, approved_by, submitted_by, external_reference
  timestamps
}

model compliance_reviews {
  id, user_id, reason, status, due_date
  scheduled_by, assigned_to, completed_by, result, findings
  timestamps
}
```

---

## Changelog v3.2.0

### Added
- Treasury Service: Gestión completa de cajas internas
- OTC Service: Operaciones de compra/venta de divisas
- Fraud Detection: Evaluación de riesgo en tiempo real
- Compliance Service: Reportes UIF y monitoreo de umbrales
- 50+ nuevos endpoints de API
- 5 nuevos modelos de base de datos
- Inicialización automática de cuentas de tesorería

### Security
- Evaluación de riesgo en cada transacción
- Blacklist de IPs sospechosas
- Audit log completo de todas las operaciones
- Control de permisos granular

---

**Simply Backend v3.2.0** - Full Backoffice Implementation
