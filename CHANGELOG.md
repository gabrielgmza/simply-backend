# Simply Backend Changelog

## v3.8.0 (2025-01-03) - Advanced Security

### 🛡️ Nuevos Servicios de Seguridad

**Fase 1 - Fundamentos:**
- ✅ **Trust Score Service** - Score de confianza 0-1000 con 5 componentes
- ✅ **Risk-Based Auth Service** - Autenticación adaptativa según riesgo
- ✅ **Device Fingerprint Service** - Identificación y trust de dispositivos
- ✅ **Kill Switch Service** - Control granular de emergencias

**Fase 2 - Inteligencia:**
- ✅ **Employee Anomaly Service** - Detección de comportamiento anómalo de empleados
- ✅ **Behavioral Analytics Service** - Análisis de comportamiento de usuarios
- ✅ **Enhanced Fraud ML Service** - Detección de fraude con ML ensemble
- ✅ **Real-time Alerting Service** - Sistema centralizado de alertas

### 📊 Estadísticas
- 8 servicios nuevos
- ~7,000 líneas de código
- 25+ endpoints API
- 15+ tablas Prisma nuevas

### 🔗 Nuevos Endpoints

**Usuario (`/api/security/`):**
- `GET /trust-score` - Obtener Trust Score
- `GET /trust-score/history` - Historial de scores
- `POST /risk-assess` - Evaluar riesgo de operación
- `POST /verify-challenge` - Verificar challenge de seguridad
- `POST /devices/register` - Registrar dispositivo
- `GET /devices` - Listar dispositivos
- `POST /devices/:id/trust` - Marcar dispositivo como confiable
- `POST /devices/:id/block` - Bloquear dispositivo
- `DELETE /devices/:id` - Eliminar dispositivo
- `GET /alerts` - Alertas del usuario

**Backoffice (`/api/backoffice/security/`):**
- `GET /trust-score/:userId` - Trust Score detallado
- `POST /trust-score/:userId/recalculate` - Recalcular
- `GET /kill-switch` - Estado del kill switch
- `POST /kill-switch/activate` - Activar kill switch
- `POST /kill-switch/deactivate` - Desactivar kill switch
- `POST /kill-switch/maintenance` - Modo mantenimiento
- `GET /anomalies` - Anomalías de empleados
- `PATCH /anomalies/:id` - Actualizar estado
- `GET /behavior/:userId` - Perfil de comportamiento
- `GET /alerts` - Alertas del backoffice
- `GET /alerts/stats` - Estadísticas de alertas

### 🗄️ Nuevas Tablas
- `trust_scores`
- `user_devices`
- `risk_assessments`
- `ip_blacklist`
- `flagged_accounts`
- `employee_anomalies`
- `employee_baselines`
- `employee_notifications`
- `user_behavior_profiles`
- `user_analytics_events`
- `fraud_evaluations`
- `alerts`
- `alert_webhooks`
- `system_settings`
- `referrals`

### 📋 Compliance Coverage Actualizado
| Estándar | Antes | Después |
|----------|-------|---------|
| PCI DSS v4.0 | 45% | 65% |
| ISO 27001 | 30% | 55% |
| NIST CSF | 40% | 60% |
| FATF/GAFI | 60% | 70% |
| OWASP ASVS L2 | 35% | 55% |

---

## v3.7.0 (2025-01-03) - Mobile App Ready

### ✅ Features
- Transferencias con validación CVU y motivos BCRA
- Gestión de contactos frecuentes
- Cierre anticipado de financiación (3% penalidad)
- Push notifications con Firebase
- Dashboard unificado móvil
- Onboarding completo con OTP

---

## v3.6.0 - v3.1.0
Ver releases anteriores...
