# Simply API - Documentación para App Móvil

**Versión:** 3.0.0  
**Base URL:** `https://api.paysur.com/api/app`  
**Autenticación:** Bearer Token (JWT)

---

## 🔐 Autenticación

### POST /auth/register
Registrar nuevo usuario.

**Body:**
```json
{
  "email": "usuario@email.com",
  "password": "minimo8caracteres",
  "firstName": "Juan",
  "lastName": "Pérez",
  "phone": "+5491112345678"
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "usuario@email.com",
      "firstName": "Juan",
      "lastName": "Pérez",
      "status": "PENDING_VERIFICATION",
      "kycStatus": "PENDING",
      "userLevel": "PLATA"
    },
    "tokens": {
      "accessToken": "eyJhbG...",
      "refreshToken": "eyJhbG...",
      "expiresIn": 3600
    }
  }
}
```

### POST /auth/login
Iniciar sesión.

**Body:**
```json
{
  "email": "usuario@email.com",
  "password": "contraseña",
  "deviceInfo": { "model": "iPhone 14", "os": "iOS 17" }
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "user": { ... },
    "tokens": {
      "accessToken": "eyJhbG...",
      "refreshToken": "eyJhbG...",
      "expiresIn": 3600
    }
  }
}
```

### POST /auth/refresh
Renovar tokens.

**Body:**
```json
{
  "refreshToken": "eyJhbG..."
}
```

### POST /auth/logout
Cerrar sesión.

**Headers:** `Authorization: Bearer {accessToken}`

---

## 👤 Perfil

### GET /profile
Obtener perfil del usuario.

**Headers:** `Authorization: Bearer {accessToken}`

### PUT /profile
Actualizar perfil.

**Body:**
```json
{
  "firstName": "Juan",
  "lastName": "Pérez",
  "phone": "+5491112345678",
  "fcmToken": "firebase-token"
}
```

### POST /profile/change-password
Cambiar contraseña.

**Body:**
```json
{
  "currentPassword": "actual",
  "newPassword": "nueva123"
}
```

---

## 💰 Wallet

### GET /wallet/balance
Obtener balance y estado de cuenta.

**Requiere:** KYC Aprobado

**Response:**
```json
{
  "success": true,
  "data": {
    "available": 150000.00,
    "pending": 0.00,
    "invested": 500000.00,
    "financed": 25000.00,
    "total": 650000.00,
    "limits": {
      "daily": 500000.00,
      "monthly": 5000000.00
    },
    "cvu": "0000285000012345678901",
    "alias": "juan.perez.simply",
    "status": "ACTIVE"
  }
}
```

### GET /wallet/movements
Obtener movimientos.

**Query params:**
- `page` (default: 1)
- `limit` (default: 20)
- `type` (opcional): TRANSFER_OUT, TRANSFER_IN, etc.
- `dateFrom` (opcional): ISO date
- `dateTo` (opcional): ISO date

### PUT /wallet/alias
Actualizar alias de cuenta.

**Body:**
```json
{
  "alias": "nuevo.alias.cuenta"
}
```

**Nota:** Máximo 3 cambios por año.

---

## 📈 Inversiones

### GET /investments
Listar inversiones del usuario.

**Response:**
```json
{
  "success": true,
  "data": {
    "investments": [...],
    "summary": {
      "totalInvested": 500000.00,
      "totalReturns": 12500.00,
      "totalCreditAvailable": 75000.00,
      "activeCount": 2,
      "annualRate": 22.08
    }
  }
}
```

### GET /investments/:id
Obtener detalle de inversión.

### POST /investments
Crear nueva inversión.

**Body:**
```json
{
  "amount": 100000
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "amount": 100000.00,
    "current_value": 100000.00,
    "credit_limit": 15000.00,
    "annual_rate": 22.08,
    "status": "ACTIVE"
  }
}
```

### POST /investments/:id/liquidate
Liquidar inversión (rescatar).

**Restricción:** No debe tener financiación activa.

### GET /investments/:id/returns
Obtener historial de rendimientos.

### POST /investments/simulate (Público)
Simular inversión.

**Body:**
```json
{
  "amount": 100000,
  "months": 12
}
```

---

## 💳 Financiación

### GET /financing
Listar financiaciones del usuario.

### GET /financing/:id
Obtener detalle con cuotas.

### POST /financing
Crear financiación.

**Body:**
```json
{
  "investmentId": "uuid",
  "amount": 15000,
  "installments": 6,
  "description": "Compra de notebook"
}
```

**Restricciones:**
- Monto máximo: 15% del valor de inversión
- Cuotas: 2 a 48
- Interés: 0%

### POST /financing/simulate (Público)
Simular financiación.

**Body:**
```json
{
  "amount": 15000,
  "installments": 6
}
```

### POST /financing/installments/:id/pay
Pagar cuota.

### POST /financing/:id/drop
Caída anticipada de cuotas.

**Nota:** Aplica penalización del 3% y liquida la inversión.

---

## 💸 Transferencias

### POST /transfers
Realizar transferencia.

**Body:**
```json
{
  "destinationCVU": "0000285000098765432101",
  "amount": 5000,
  "motive": "VAR",
  "reference": "Pago de servicio"
}
```

O con alias:
```json
{
  "destinationAlias": "maria.garcia.simply",
  "amount": 5000,
  "motive": "ALQ",
  "reference": "Alquiler enero"
}
```

**Motivos BCRA válidos:**
- `VAR` - Varios
- `ALQ` - Alquileres
- `CUO` - Cuotas
- `EXP` - Expensas
- `FAC` - Facturas
- `PRE` - Préstamos
- `SEG` - Seguros
- `HON` - Honorarios
- `HAB` - Haberes
- `JUB` - Jubilaciones

### POST /transfers/validate
Validar destino antes de transferir.

**Body:**
```json
{
  "identifier": "0000285000098765432101"
}
```

### GET /transfers/motives
Obtener lista de motivos BCRA.

---

## 📇 Contactos

### GET /contacts
Listar contactos frecuentes.

**Query params:**
- `search` (opcional)
- `favoritesOnly` (opcional): true/false
- `limit` (default: 50)

### POST /contacts
Guardar contacto.

**Body:**
```json
{
  "cvu": "0000285000098765432101",
  "alias": "maria.garcia.simply",
  "name": "María García",
  "isFavorite": true
}
```

### DELETE /contacts/:id
Eliminar contacto.

### POST /contacts/:id/favorite
Toggle favorito.

---

## 🚨 Códigos de Error

| Código | Descripción |
|--------|-------------|
| `MISSING_TOKEN` | Token no proporcionado |
| `INVALID_TOKEN` | Token inválido o expirado |
| `USER_NOT_FOUND` | Usuario no existe |
| `ACCOUNT_INACTIVE` | Cuenta suspendida/bloqueada |
| `KYC_REQUIRED` | Verificación de identidad requerida |
| `RATE_LIMIT_EXCEEDED` | Demasiadas solicitudes |

---

## 📱 Integración con App

### Headers requeridos
```
Authorization: Bearer {accessToken}
Content-Type: application/json
```

### Almacenamiento seguro de tokens
- **iOS:** Keychain
- **Android:** Keystore/EncryptedSharedPreferences

### Refresh Token Flow
```
1. Access token expira (401 INVALID_TOKEN)
2. Llamar POST /auth/refresh con refreshToken
3. Obtener nuevos tokens
4. Reintentar request original
5. Si refresh falla → logout y login
```

### Rate Limits
- `/auth/register`: 5 req/15min
- `/auth/login`: 10 req/15min
- `/investments`: 5 req/min
- `/financing`: 5 req/min
- `/transfers`: 10 req/min

---

## 🔄 Webhooks (Futuro)

Para notificaciones en tiempo real:
- Transferencia recibida
- Rendimiento acreditado
- Cuota por vencer
- Cambio de estado KYC

---

## 📞 Soporte

**Email:** soporte@paysur.com  
**Documentación:** https://docs.paysur.com
