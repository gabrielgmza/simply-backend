import { PrismaClient } from '@prisma/client';
import { auditLogService } from '../backoffice/auditLogService';

const prisma = new PrismaClient();

// ============================================
// KILL SWITCH SERVICE
// Control granular para desactivar funcionalidades en emergencias
// ============================================

export type KillSwitchScope = 
  | 'GLOBAL'              // Todo el sistema
  | 'PRODUCT'             // Producto específico
  | 'REGION'              // País/región
  | 'USER_SEGMENT'        // Segmento de usuarios
  | 'TRANSACTION_TYPE';   // Tipo de transacción

export type KillSwitchProduct = 
  | 'transfers'
  | 'investments'
  | 'financing'
  | 'cards'
  | 'qr_payments'
  | 'service_payments'
  | 'withdrawals'
  | 'deposits'
  | 'crypto'
  | 'all';

export type KillSwitchUserSegment = 
  | 'new_users'           // < 30 días
  | 'low_trust'           // Trust score < 400
  | 'high_risk'           // Con alertas activas
  | 'unverified'          // KYC no aprobado
  | 'level_plata'
  | 'level_oro'
  | 'level_black'
  | 'level_diamante'
  | 'all';

export interface KillSwitchState {
  // Global
  globalKill: boolean;
  maintenanceMode: boolean;
  
  // Por producto
  products: Record<KillSwitchProduct, boolean>;
  
  // Por región
  regions: Record<string, boolean>;  // AR, BR, etc.
  
  // Por segmento de usuario
  userSegments: Record<KillSwitchUserSegment, boolean>;
  
  // Por tipo de transacción
  transactionTypes: {
    incoming: boolean;
    outgoing: boolean;
    internal: boolean;
    international: boolean;
  };
  
  // Auto-triggers (thresholds)
  autoTriggers: {
    enabled: boolean;
    fraudRateThreshold: number;      // % de fraude para activar
    errorRateThreshold: number;      // % de errores para activar
    volumeAnomalyMultiplier: number; // Multiplicador del promedio
  };
  
  // Metadata
  lastModified: Date;
  modifiedBy: string;
  activeKillSwitches: ActiveKillSwitch[];
}

interface ActiveKillSwitch {
  id: string;
  scope: KillSwitchScope;
  target: string;
  reason: string;
  activatedAt: Date;
  activatedBy: string;
  expiresAt?: Date;
  autoActivated: boolean;
}

interface KillSwitchCheck {
  allowed: boolean;
  blockedBy?: string;
  reason?: string;
  retryAfter?: Date;
}

// Estado en memoria (cache)
let killSwitchCache: KillSwitchState | null = null;
let cacheLastUpdated: Date | null = null;
const CACHE_TTL_MS = 10000; // 10 segundos

export const killSwitchService = {
  // ==========================================
  // OBTENER ESTADO ACTUAL
  // ==========================================

  async getState(): Promise<KillSwitchState> {
    // Usar cache si es reciente
    if (killSwitchCache && cacheLastUpdated && 
        Date.now() - cacheLastUpdated.getTime() < CACHE_TTL_MS) {
      return killSwitchCache;
    }

    // Cargar de DB
    const config = await prisma.system_settings.findUnique({
      where: { key: 'kill_switch_state' }
    });

    if (config) {
      killSwitchCache = config.value as unknown as KillSwitchState;
    } else {
      // Estado por defecto (todo habilitado)
      killSwitchCache = this.getDefaultState();
      await this.saveState(killSwitchCache, 'system');
    }

    cacheLastUpdated = new Date();
    return killSwitchCache;
  },

  getDefaultState(): KillSwitchState {
    return {
      globalKill: false,
      maintenanceMode: false,
      products: {
        transfers: false,
        investments: false,
        financing: false,
        cards: false,
        qr_payments: false,
        service_payments: false,
        withdrawals: false,
        deposits: false,
        crypto: false,
        all: false
      },
      regions: {
        AR: false,
        BR: false,
        CL: false,
        UY: false,
        MX: false
      },
      userSegments: {
        new_users: false,
        low_trust: false,
        high_risk: false,
        unverified: false,
        level_plata: false,
        level_oro: false,
        level_black: false,
        level_diamante: false,
        all: false
      },
      transactionTypes: {
        incoming: false,
        outgoing: false,
        internal: false,
        international: false
      },
      autoTriggers: {
        enabled: true,
        fraudRateThreshold: 5,       // 5% de fraude
        errorRateThreshold: 10,      // 10% de errores
        volumeAnomalyMultiplier: 10  // 10x el promedio
      },
      lastModified: new Date(),
      modifiedBy: 'system',
      activeKillSwitches: []
    };
  },

  // ==========================================
  // VERIFICAR SI OPERACIÓN ESTÁ PERMITIDA
  // ==========================================

  async checkOperation(params: {
    userId: string;
    operation: string;
    product: KillSwitchProduct;
    transactionType?: 'incoming' | 'outgoing' | 'internal' | 'international';
    region?: string;
  }): Promise<KillSwitchCheck> {
    const state = await this.getState();

    // 1. Kill global
    if (state.globalKill) {
      return {
        allowed: false,
        blockedBy: 'GLOBAL_KILL',
        reason: 'Sistema temporalmente suspendido por mantenimiento de emergencia.'
      };
    }

    // 2. Modo mantenimiento
    if (state.maintenanceMode) {
      return {
        allowed: false,
        blockedBy: 'MAINTENANCE_MODE',
        reason: 'Sistema en mantenimiento programado. Volvemos pronto.'
      };
    }

    // 3. Kill por producto
    if (state.products[params.product] || state.products.all) {
      return {
        allowed: false,
        blockedBy: `PRODUCT_${params.product.toUpperCase()}`,
        reason: `${this.formatProductName(params.product)} temporalmente no disponible.`
      };
    }

    // 4. Kill por región
    if (params.region && state.regions[params.region]) {
      return {
        allowed: false,
        blockedBy: `REGION_${params.region}`,
        reason: `Servicio temporalmente no disponible en tu región.`
      };
    }

    // 5. Kill por tipo de transacción
    if (params.transactionType && state.transactionTypes[params.transactionType]) {
      return {
        allowed: false,
        blockedBy: `TX_TYPE_${params.transactionType.toUpperCase()}`,
        reason: `Este tipo de operación está temporalmente suspendido.`
      };
    }

    // 6. Kill por segmento de usuario
    const userSegmentBlocked = await this.checkUserSegment(params.userId, state);
    if (userSegmentBlocked) {
      return userSegmentBlocked;
    }

    return { allowed: true };
  },

  async checkUserSegment(userId: string, state: KillSwitchState): Promise<KillSwitchCheck | null> {
    // All users
    if (state.userSegments.all) {
      return {
        allowed: false,
        blockedBy: 'USER_SEGMENT_ALL',
        reason: 'Operaciones temporalmente suspendidas para todos los usuarios.'
      };
    }

    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: {
        created_at: true,
        user_level: true,
        kyc_status: true
      }
    });

    if (!user) return null;

    // New users
    const accountAgeDays = (Date.now() - user.created_at.getTime()) / (1000 * 60 * 60 * 24);
    if (state.userSegments.new_users && accountAgeDays < 30) {
      return {
        allowed: false,
        blockedBy: 'USER_SEGMENT_NEW',
        reason: 'Operaciones temporalmente limitadas para cuentas nuevas.'
      };
    }

    // Low trust
    if (state.userSegments.low_trust) {
      const trustScore = await prisma.trust_scores.findFirst({
        where: { user_id: userId },
        orderBy: { calculated_at: 'desc' }
      });
      
      if (trustScore && trustScore.score < 400) {
        return {
          allowed: false,
          blockedBy: 'USER_SEGMENT_LOW_TRUST',
          reason: 'Tu cuenta requiere verificación adicional.'
        };
      }
    }

    // High risk (con alertas activas)
    if (state.userSegments.high_risk) {
      const alerts = await prisma.fraud_alerts.count({
        where: {
          user_id: userId,
          status: { in: ['PENDING', 'INVESTIGATING'] }
        }
      });

      if (alerts > 0) {
        return {
          allowed: false,
          blockedBy: 'USER_SEGMENT_HIGH_RISK',
          reason: 'Tu cuenta está bajo revisión de seguridad.'
        };
      }
    }

    // Unverified
    if (state.userSegments.unverified && user.kyc_status !== 'APPROVED') {
      return {
        allowed: false,
        blockedBy: 'USER_SEGMENT_UNVERIFIED',
        reason: 'Completá la verificación de identidad para continuar.'
      };
    }

    // Por nivel
    const levelKey = `level_${user.user_level.toLowerCase()}` as KillSwitchUserSegment;
    if (state.userSegments[levelKey]) {
      return {
        allowed: false,
        blockedBy: `USER_SEGMENT_${user.user_level}`,
        reason: `Operaciones temporalmente limitadas para usuarios ${user.user_level}.`
      };
    }

    return null;
  },

  // ==========================================
  // ACTIVAR KILL SWITCH
  // ==========================================

  async activate(params: {
    scope: KillSwitchScope;
    target: string;
    reason: string;
    activatedBy: string;
    expiresInMinutes?: number;
  }): Promise<KillSwitchState> {
    const state = await this.getState();

    // Aplicar según scope
    switch (params.scope) {
      case 'GLOBAL':
        state.globalKill = true;
        break;

      case 'PRODUCT':
        if (params.target in state.products) {
          state.products[params.target as KillSwitchProduct] = true;
        }
        break;

      case 'REGION':
        state.regions[params.target] = true;
        break;

      case 'USER_SEGMENT':
        if (params.target in state.userSegments) {
          state.userSegments[params.target as KillSwitchUserSegment] = true;
        }
        break;

      case 'TRANSACTION_TYPE':
        if (params.target in state.transactionTypes) {
          (state.transactionTypes as any)[params.target] = true;
        }
        break;
    }

    // Registrar kill switch activo
    const activeSwitch: ActiveKillSwitch = {
      id: crypto.randomUUID(),
      scope: params.scope,
      target: params.target,
      reason: params.reason,
      activatedAt: new Date(),
      activatedBy: params.activatedBy,
      expiresAt: params.expiresInMinutes 
        ? new Date(Date.now() + params.expiresInMinutes * 60 * 1000)
        : undefined,
      autoActivated: false
    };

    state.activeKillSwitches.push(activeSwitch);
    state.lastModified = new Date();
    state.modifiedBy = params.activatedBy;

    await this.saveState(state, params.activatedBy);

    // Audit log
    await auditLogService.log({
      action: 'KILL_SWITCH_ACTIVATED',
      actorType: 'employee',
      actorId: params.activatedBy,
      resource: 'kill_switch',
      resourceId: activeSwitch.id,
      description: `Kill switch activado: ${params.scope} - ${params.target}`,
      severity: 'CRITICAL',
      metadata: params
    });

    return state;
  },

  // ==========================================
  // DESACTIVAR KILL SWITCH
  // ==========================================

  async deactivate(params: {
    scope: KillSwitchScope;
    target: string;
    deactivatedBy: string;
    reason: string;
  }): Promise<KillSwitchState> {
    const state = await this.getState();

    // Desactivar según scope
    switch (params.scope) {
      case 'GLOBAL':
        state.globalKill = false;
        break;

      case 'PRODUCT':
        if (params.target in state.products) {
          state.products[params.target as KillSwitchProduct] = false;
        }
        break;

      case 'REGION':
        state.regions[params.target] = false;
        break;

      case 'USER_SEGMENT':
        if (params.target in state.userSegments) {
          state.userSegments[params.target as KillSwitchUserSegment] = false;
        }
        break;

      case 'TRANSACTION_TYPE':
        if (params.target in state.transactionTypes) {
          (state.transactionTypes as any)[params.target] = false;
        }
        break;
    }

    // Remover de lista activa
    state.activeKillSwitches = state.activeKillSwitches.filter(
      ks => !(ks.scope === params.scope && ks.target === params.target)
    );

    state.lastModified = new Date();
    state.modifiedBy = params.deactivatedBy;

    await this.saveState(state, params.deactivatedBy);

    // Audit log
    await auditLogService.log({
      action: 'KILL_SWITCH_DEACTIVATED',
      actorType: 'employee',
      actorId: params.deactivatedBy,
      resource: 'kill_switch',
      description: `Kill switch desactivado: ${params.scope} - ${params.target}`,
      severity: 'HIGH',
      metadata: params
    });

    return state;
  },

  // ==========================================
  // ACTIVAR MODO MANTENIMIENTO
  // ==========================================

  async activateMaintenance(params: {
    activatedBy: string;
    reason: string;
    estimatedDurationMinutes: number;
  }): Promise<KillSwitchState> {
    const state = await this.getState();
    state.maintenanceMode = true;
    state.lastModified = new Date();
    state.modifiedBy = params.activatedBy;

    const activeSwitch: ActiveKillSwitch = {
      id: crypto.randomUUID(),
      scope: 'GLOBAL',
      target: 'MAINTENANCE',
      reason: params.reason,
      activatedAt: new Date(),
      activatedBy: params.activatedBy,
      expiresAt: new Date(Date.now() + params.estimatedDurationMinutes * 60 * 1000),
      autoActivated: false
    };

    state.activeKillSwitches.push(activeSwitch);
    await this.saveState(state, params.activatedBy);

    return state;
  },

  async deactivateMaintenance(deactivatedBy: string): Promise<KillSwitchState> {
    const state = await this.getState();
    state.maintenanceMode = false;
    state.activeKillSwitches = state.activeKillSwitches.filter(
      ks => ks.target !== 'MAINTENANCE'
    );
    state.lastModified = new Date();
    state.modifiedBy = deactivatedBy;

    await this.saveState(state, deactivatedBy);
    return state;
  },

  // ==========================================
  // AUTO-TRIGGERS (monitoreo automático)
  // ==========================================

  async checkAutoTriggers(): Promise<void> {
    const state = await this.getState();
    if (!state.autoTriggers.enabled) return;

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // 1. Verificar tasa de fraude
    const [totalTx, fraudTx] = await Promise.all([
      prisma.transactions.count({
        where: { created_at: { gte: oneHourAgo } }
      }),
      prisma.fraud_alerts.count({
        where: {
          created_at: { gte: oneHourAgo },
          alert_type: 'CONFIRMED_FRAUD'
        }
      })
    ]);

    if (totalTx > 0) {
      const fraudRate = (fraudTx / totalTx) * 100;
      if (fraudRate >= state.autoTriggers.fraudRateThreshold) {
        await this.autoActivate('FRAUD_RATE_EXCEEDED', `Tasa de fraude: ${fraudRate.toFixed(2)}%`);
      }
    }

    // 2. Verificar tasa de errores
    const errorTx = await prisma.transactions.count({
      where: {
        created_at: { gte: oneHourAgo },
        status: 'FAILED'
      }
    });

    if (totalTx > 0) {
      const errorRate = (errorTx / totalTx) * 100;
      if (errorRate >= state.autoTriggers.errorRateThreshold) {
        await this.autoActivate('ERROR_RATE_EXCEEDED', `Tasa de error: ${errorRate.toFixed(2)}%`);
      }
    }

    // 3. Verificar anomalía de volumen
    const avgHourlyTx = await this.getAverageHourlyTransactions();
    if (avgHourlyTx > 0 && totalTx > avgHourlyTx * state.autoTriggers.volumeAnomalyMultiplier) {
      await this.autoActivate('VOLUME_ANOMALY', `Volumen: ${totalTx} (promedio: ${avgHourlyTx})`);
    }
  },

  async autoActivate(reason: string, details: string): Promise<void> {
    const state = await this.getState();

    // Verificar si ya está activo por esta razón
    const alreadyActive = state.activeKillSwitches.some(
      ks => ks.autoActivated && ks.reason.includes(reason)
    );

    if (alreadyActive) return;

    // Activar kill switch automático (solo transferencias salientes)
    await this.activate({
      scope: 'TRANSACTION_TYPE',
      target: 'outgoing',
      reason: `[AUTO] ${reason}: ${details}`,
      activatedBy: 'system_auto_trigger',
      expiresInMinutes: 30 // Auto-expira en 30 min
    });

    // Notificar a admins
    await this.notifyAdmins(reason, details);
  },

  async notifyAdmins(reason: string, details: string): Promise<void> {
    // Obtener admins
    const admins = await prisma.employees.findMany({
      where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] }, status: 'ACTIVE' }
    });

    // Crear notificaciones
    // TODO: Enviar por email/SMS/push
    console.log(`🚨 KILL SWITCH AUTO-ACTIVADO: ${reason} - ${details}`);
  },

  async getAverageHourlyTransactions(): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const result = await prisma.transactions.groupBy({
      by: ['created_at'],
      where: { created_at: { gte: sevenDaysAgo } },
      _count: true
    });

    const totalTx = result.reduce((sum, r) => sum + r._count, 0);
    const hours = 7 * 24;
    return totalTx / hours;
  },

  // ==========================================
  // HELPERS
  // ==========================================

  async saveState(state: KillSwitchState, modifiedBy: string): Promise<void> {
    await prisma.system_settings.upsert({
      where: { key: 'kill_switch_state' },
      create: {
        key: 'kill_switch_state',
        value: state as any,
        description: 'Estado del kill switch del sistema',
        category: 'security',
        updated_by: modifiedBy
      },
      update: {
        value: state as any,
        updated_by: modifiedBy
      }
    });

    // Invalidar cache
    killSwitchCache = state;
    cacheLastUpdated = new Date();
  },

  formatProductName(product: KillSwitchProduct): string {
    const names: Record<KillSwitchProduct, string> = {
      transfers: 'Transferencias',
      investments: 'Inversiones',
      financing: 'Financiación',
      cards: 'Tarjetas',
      qr_payments: 'Pagos QR',
      service_payments: 'Pago de servicios',
      withdrawals: 'Retiros',
      deposits: 'Depósitos',
      crypto: 'Cripto',
      all: 'Todos los servicios'
    };
    return names[product] || product;
  },

  // ==========================================
  // LIMPIAR KILL SWITCHES EXPIRADOS
  // ==========================================

  async cleanupExpired(): Promise<number> {
    const state = await this.getState();
    const now = new Date();

    const expired = state.activeKillSwitches.filter(
      ks => ks.expiresAt && ks.expiresAt < now
    );

    for (const ks of expired) {
      await this.deactivate({
        scope: ks.scope,
        target: ks.target,
        deactivatedBy: 'system_auto_cleanup',
        reason: 'Expiración automática'
      });
    }

    return expired.length;
  },

  // ==========================================
  // ESTADÍSTICAS
  // ==========================================

  async getStats() {
    const state = await this.getState();

    return {
      globalKill: state.globalKill,
      maintenanceMode: state.maintenanceMode,
      activeCount: state.activeKillSwitches.length,
      byScope: {
        global: state.activeKillSwitches.filter(ks => ks.scope === 'GLOBAL').length,
        product: state.activeKillSwitches.filter(ks => ks.scope === 'PRODUCT').length,
        region: state.activeKillSwitches.filter(ks => ks.scope === 'REGION').length,
        userSegment: state.activeKillSwitches.filter(ks => ks.scope === 'USER_SEGMENT').length,
        transactionType: state.activeKillSwitches.filter(ks => ks.scope === 'TRANSACTION_TYPE').length
      },
      autoActivated: state.activeKillSwitches.filter(ks => ks.autoActivated).length,
      lastModified: state.lastModified,
      modifiedBy: state.modifiedBy
    };
  }
};

// Importar crypto para UUID
import crypto from 'crypto';
