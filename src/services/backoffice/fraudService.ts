// ============================================
// FRAUD DETECTION SERVICE
// Simply Backend v3.2.0
// ============================================

import { PrismaClient, Prisma } from '@prisma/client';
import { auditLogService } from './auditLogService';

const prisma = new PrismaClient();

// Tipos
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type AlertStatus = 'PENDING' | 'REVIEWING' | 'RESOLVED' | 'ESCALATED' | 'FALSE_POSITIVE';
type AlertType = 
  | 'HIGH_AMOUNT'
  | 'UNUSUAL_PATTERN'
  | 'VELOCITY_BREACH'
  | 'SUSPICIOUS_IP'
  | 'NEW_DEVICE'
  | 'LOCATION_ANOMALY'
  | 'RECIPIENT_RISK'
  | 'TIME_ANOMALY';

interface TransactionContext {
  userId: string;
  accountId: string;
  type: string;
  amount: number;
  currency: string;
  recipientId?: string;
  recipientCVU?: string;
  ip?: string;
  deviceId?: string;
  userAgent?: string;
  location?: { lat: number; lng: number };
}

interface RiskScore {
  score: number;          // 0-100
  level: RiskLevel;
  factors: RiskFactor[];
  shouldBlock: boolean;
  requiresReview: boolean;
}

interface RiskFactor {
  type: AlertType;
  weight: number;
  score: number;
  details: string;
}

// ============================================
// RISK SCORING ENGINE
// ============================================

/**
 * Evaluar riesgo de transacción
 */
async function evaluateTransaction(ctx: TransactionContext): Promise<RiskScore> {
  const factors: RiskFactor[] = [];
  let totalScore = 0;
  
  // 1. Evaluar monto
  const amountFactor = await evaluateAmount(ctx);
  if (amountFactor) factors.push(amountFactor);
  
  // 2. Evaluar velocidad (transacciones recientes)
  const velocityFactor = await evaluateVelocity(ctx);
  if (velocityFactor) factors.push(velocityFactor);
  
  // 3. Evaluar patrón de comportamiento
  const patternFactor = await evaluatePattern(ctx);
  if (patternFactor) factors.push(patternFactor);
  
  // 4. Evaluar IP
  const ipFactor = await evaluateIP(ctx);
  if (ipFactor) factors.push(ipFactor);
  
  // 5. Evaluar dispositivo
  const deviceFactor = await evaluateDevice(ctx);
  if (deviceFactor) factors.push(deviceFactor);
  
  // 6. Evaluar destinatario
  const recipientFactor = await evaluateRecipient(ctx);
  if (recipientFactor) factors.push(recipientFactor);
  
  // 7. Evaluar horario
  const timeFactor = await evaluateTime(ctx);
  if (timeFactor) factors.push(timeFactor);

  // Calcular score total (promedio ponderado)
  for (const factor of factors) {
    totalScore += factor.score * factor.weight;
  }
  
  const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
  const normalizedScore = totalWeight > 0 ? Math.round(totalScore / totalWeight) : 0;

  // Determinar nivel y acciones
  let level: RiskLevel = 'LOW';
  let shouldBlock = false;
  let requiresReview = false;

  if (normalizedScore >= 80) {
    level = 'CRITICAL';
    shouldBlock = true;
    requiresReview = true;
  } else if (normalizedScore >= 60) {
    level = 'HIGH';
    requiresReview = true;
  } else if (normalizedScore >= 40) {
    level = 'MEDIUM';
    requiresReview = normalizedScore >= 50;
  }

  return {
    score: normalizedScore,
    level,
    factors,
    shouldBlock,
    requiresReview,
  };
}

/**
 * Evaluar monto
 */
async function evaluateAmount(ctx: TransactionContext): Promise<RiskFactor | null> {
  // Obtener histórico del usuario
  const userStats = await prisma.transactions.aggregate({
    where: {
      account_id: ctx.accountId,
      status: 'COMPLETED',
      created_at: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }, // 90 días
    },
    _avg: { amount: true },
    _max: { amount: true },
  });

  const avgAmount = parseFloat(userStats._avg.amount?.toString() || '0');
  const maxAmount = parseFloat(userStats._max.amount?.toString() || '0');

  // Si no hay histórico, usar umbrales absolutos
  if (avgAmount === 0) {
    if (ctx.amount > 1000000) { // > $1M
      return {
        type: 'HIGH_AMOUNT',
        weight: 1.5,
        score: 70,
        details: 'Primera transacción de alto monto sin histórico',
      };
    }
    return null;
  }

  // Ratio respecto al promedio
  const ratio = ctx.amount / avgAmount;

  if (ratio > 10) {
    return {
      type: 'HIGH_AMOUNT',
      weight: 1.5,
      score: 90,
      details: `Monto ${ratio.toFixed(1)}x mayor al promedio`,
    };
  } else if (ratio > 5) {
    return {
      type: 'HIGH_AMOUNT',
      weight: 1.5,
      score: 60,
      details: `Monto ${ratio.toFixed(1)}x mayor al promedio`,
    };
  } else if (ratio > 3) {
    return {
      type: 'HIGH_AMOUNT',
      weight: 1.0,
      score: 30,
      details: `Monto ${ratio.toFixed(1)}x mayor al promedio`,
    };
  }

  return null;
}

/**
 * Evaluar velocidad de transacciones
 */
async function evaluateVelocity(ctx: TransactionContext): Promise<RiskFactor | null> {
  // Transacciones en la última hora
  const lastHour = await prisma.transactions.count({
    where: {
      account_id: ctx.accountId,
      created_at: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
  });

  // Transacciones en las últimas 24 horas
  const last24h = await prisma.transactions.count({
    where: {
      account_id: ctx.accountId,
      created_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  });

  // Monto total en las últimas 24 horas
  const sum24h = await prisma.transactions.aggregate({
    where: {
      account_id: ctx.accountId,
      created_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    _sum: { amount: true },
  });

  const total24h = parseFloat(sum24h._sum.amount?.toString() || '0');

  if (lastHour >= 10) {
    return {
      type: 'VELOCITY_BREACH',
      weight: 2.0,
      score: 95,
      details: `${lastHour} transacciones en la última hora`,
    };
  } else if (lastHour >= 5) {
    return {
      type: 'VELOCITY_BREACH',
      weight: 1.5,
      score: 70,
      details: `${lastHour} transacciones en la última hora`,
    };
  } else if (last24h >= 20) {
    return {
      type: 'VELOCITY_BREACH',
      weight: 1.5,
      score: 60,
      details: `${last24h} transacciones en 24 horas`,
    };
  }

  // Verificar monto acumulado
  const account = await prisma.accounts.findUnique({
    where: { id: ctx.accountId },
  });

  if (account) {
    const dailyLimit = parseFloat(account.daily_limit.toString());
    if (total24h + ctx.amount > dailyLimit * 0.9) {
      return {
        type: 'VELOCITY_BREACH',
        weight: 1.2,
        score: 50,
        details: 'Cerca del límite diario',
      };
    }
  }

  return null;
}

/**
 * Evaluar patrón de comportamiento
 */
async function evaluatePattern(ctx: TransactionContext): Promise<RiskFactor | null> {
  // Obtener patrones históricos
  const recentTx = await prisma.transactions.findMany({
    where: {
      account_id: ctx.accountId,
      created_at: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { created_at: 'desc' },
    take: 50,
  });

  if (recentTx.length < 5) return null;

  // Detectar montos redondos sospechosos consecutivos
  const roundAmounts = recentTx.filter(tx => {
    const amount = parseFloat(tx.amount.toString());
    return amount % 1000 === 0 && amount >= 10000;
  });

  if (roundAmounts.length >= 5) {
    return {
      type: 'UNUSUAL_PATTERN',
      weight: 1.3,
      score: 55,
      details: 'Múltiples transacciones de montos redondos',
    };
  }

  // Detectar smurfing (muchas transacciones pequeñas)
  const smallTx = recentTx.filter(tx => parseFloat(tx.amount.toString()) < 50000);
  if (smallTx.length >= 10) {
    const totalSmall = smallTx.reduce((sum, tx) => sum + parseFloat(tx.amount.toString()), 0);
    if (totalSmall > 500000) {
      return {
        type: 'UNUSUAL_PATTERN',
        weight: 1.5,
        score: 75,
        details: 'Posible fraccionamiento de operaciones (smurfing)',
      };
    }
  }

  return null;
}

/**
 * Evaluar IP
 */
async function evaluateIP(ctx: TransactionContext): Promise<RiskFactor | null> {
  if (!ctx.ip) return null;

  // Buscar si la IP está en lista negra
  const blacklistedIP = await prisma.blacklisted_ips.findUnique({
    where: { ip: ctx.ip },
  });

  if (blacklistedIP) {
    return {
      type: 'SUSPICIOUS_IP',
      weight: 2.0,
      score: 100,
      details: `IP en lista negra: ${blacklistedIP.reason}`,
    };
  }

  // Verificar si es una IP nueva para el usuario
  const knownIPs = await prisma.user_sessions.findMany({
    where: { user_id: ctx.userId },
    select: { ip_address: true },
    distinct: ['ip_address'],
  });

  const isNewIP = !knownIPs.some(s => s.ip_address === ctx.ip);
  if (isNewIP) {
    return {
      type: 'SUSPICIOUS_IP',
      weight: 0.8,
      score: 30,
      details: 'Nueva IP para este usuario',
    };
  }

  // Verificar uso de VPN/Proxy (simplificado)
  if (ctx.ip.startsWith('10.') || ctx.ip.startsWith('192.168.')) {
    return {
      type: 'SUSPICIOUS_IP',
      weight: 0.5,
      score: 20,
      details: 'IP de red privada',
    };
  }

  return null;
}

/**
 * Evaluar dispositivo
 */
async function evaluateDevice(ctx: TransactionContext): Promise<RiskFactor | null> {
  if (!ctx.deviceId) return null;

  // Verificar si es un dispositivo nuevo - device_info es JSON con deviceId dentro
  const knownSessions = await prisma.user_sessions.findMany({
    where: { user_id: ctx.userId },
    select: { device_info: true },
  });

  const knownDeviceIds = knownSessions
    .map(s => (s.device_info as any)?.deviceId)
    .filter(Boolean);

  const isNewDevice = !knownDeviceIds.includes(ctx.deviceId);
  
  if (isNewDevice) {
    // Verificar si el dispositivo está asociado a otras cuentas
    const allSessions = await prisma.user_sessions.findMany({
      where: {
        user_id: { not: ctx.userId },
      },
      select: { user_id: true, device_info: true },
    });

    const otherUsersWithDevice = new Set(
      allSessions
        .filter(s => (s.device_info as any)?.deviceId === ctx.deviceId)
        .map(s => s.user_id)
    );

    if (otherUsersWithDevice.size > 0) {
      return {
        type: 'NEW_DEVICE',
        weight: 1.5,
        score: 70,
        details: `Dispositivo asociado a ${otherUsersWithDevice.size} otras cuentas`,
      };
    }

    return {
      type: 'NEW_DEVICE',
      weight: 0.8,
      score: 25,
      details: 'Nuevo dispositivo para este usuario',
    };
  }

  return null;
}

/**
 * Evaluar destinatario
 */
async function evaluateRecipient(ctx: TransactionContext): Promise<RiskFactor | null> {
  if (!ctx.recipientId && !ctx.recipientCVU) return null;

  let recipientAccount;

  if (ctx.recipientCVU) {
    recipientAccount = await prisma.accounts.findFirst({
      where: { cvu: ctx.recipientCVU },
      include: { user: true },
    });
  } else if (ctx.recipientId) {
    recipientAccount = await prisma.accounts.findFirst({
      where: { user_id: ctx.recipientId },
      include: { user: true },
    });
  }

  if (!recipientAccount) return null;

  // Verificar si el destinatario tiene flags de riesgo
  const recipientFlags = await prisma.risk_flags.findMany({
    where: {
      user_id: recipientAccount.user_id,
      status: 'active',
    },
  });

  if (recipientFlags.some(f => f.severity === 'critical')) {
    return {
      type: 'RECIPIENT_RISK',
      weight: 2.0,
      score: 90,
      details: 'Destinatario con flag de riesgo crítico',
    };
  }

  if (recipientFlags.some(f => f.severity === 'high')) {
    return {
      type: 'RECIPIENT_RISK',
      weight: 1.5,
      score: 60,
      details: 'Destinatario con flag de riesgo alto',
    };
  }

  // Verificar si es cuenta nueva
  const accountAge = Date.now() - new Date(recipientAccount.created_at).getTime();
  const daysSinceCreation = accountAge / (1000 * 60 * 60 * 24);

  if (daysSinceCreation < 7) {
    return {
      type: 'RECIPIENT_RISK',
      weight: 1.0,
      score: 40,
      details: 'Destinatario con cuenta creada hace menos de 7 días',
    };
  }

  return null;
}

/**
 * Evaluar horario
 */
async function evaluateTime(ctx: TransactionContext): Promise<RiskFactor | null> {
  const hour = new Date().getHours();

  // Transacciones entre 2-5 AM
  if (hour >= 2 && hour <= 5) {
    return {
      type: 'TIME_ANOMALY',
      weight: 0.5,
      score: 25,
      details: 'Transacción en horario inusual (madrugada)',
    };
  }

  return null;
}

// ============================================
// ALERT MANAGEMENT
// ============================================

/**
 * Crear alerta de fraude
 */
async function createAlert(
  userId: string,
  transactionId: string,
  riskScore: RiskScore
): Promise<any> {
  const alert = await prisma.fraud_alerts.create({
    data: {
      user_id: userId,
      transaction_id: transactionId,
      risk_score: riskScore.score,
      risk_level: riskScore.level,
      factors: riskScore.factors as any,
      status: 'PENDING',
      auto_blocked: riskScore.shouldBlock,
    },
  });

  // Log
  await auditLogService.log({
    actorType: 'system',
    action: 'create',
    resource: 'fraud_alerts',
    resourceId: alert.id,
    description: `Alerta de fraude creada - Nivel: ${riskScore.level}, Score: ${riskScore.score}`,
    newData: { riskScore },
  });

  return alert;
}

/**
 * Listar alertas
 */
async function listAlerts(options: {
  page?: number;
  limit?: number;
  status?: AlertStatus;
  level?: RiskLevel;
  userId?: string;
} = {}): Promise<{ alerts: any[]; total: number }> {
  const { page = 1, limit = 20, status, level, userId } = options;

  const where: any = {};
  if (status) where.status = status;
  if (level) where.risk_level = level;
  if (userId) where.user_id = userId;

  const [alerts, total] = await Promise.all([
    prisma.fraud_alerts.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        users: {
          select: { id: true, email: true, first_name: true, last_name: true },
        },
        transactions: true,
      },
    }),
    prisma.fraud_alerts.count({ where }),
  ]);

  return { alerts, total };
}

/**
 * Revisar alerta
 */
async function reviewAlert(
  alertId: string,
  employeeId: string,
  resolution: AlertStatus,
  notes: string
): Promise<any> {
  const alert = await prisma.fraud_alerts.findUnique({
    where: { id: alertId },
  });

  if (!alert) {
    throw new Error('Alerta no encontrada');
  }

  const updated = await prisma.fraud_alerts.update({
    where: { id: alertId },
    data: {
      status: resolution,
      reviewed_by: employeeId,
      reviewed_at: new Date(),
      notes,
    },
  });

  // Si es falso positivo, ajustar modelos (placeholder)
  if (resolution === 'FALSE_POSITIVE') {
    // TODO: Feedback al modelo ML
  }

  // Si se confirma fraude, tomar acciones
  if (resolution === 'ESCALATED') {
    // Bloquear usuario
    await prisma.users.update({
      where: { id: alert.user_id },
      data: { status: 'BLOCKED' },
    });

    // Crear risk flag
    await prisma.risk_flags.create({
      data: {
        user_id: alert.user_id,
        type: 'fraud_confirmed',
        severity: 'critical',
        description: `Fraude confirmado - Alerta ${alertId}`,
        status: 'active',
        action_taken: 'blocked',
        created_by: employeeId,
      },
    });
  }

  await auditLogService.log({
    actorType: 'employee',
    actorId: employeeId,
    action: 'review',
    resource: 'fraud_alerts',
    resourceId: alertId,
    description: `Alerta revisada: ${resolution}`,
    newData: { resolution, notes },
  });

  return updated;
}

/**
 * Obtener estadísticas de fraude
 */
async function getStats(days: number = 30): Promise<{
  totalAlerts: number;
  byLevel: { level: string; count: number }[];
  byStatus: { status: string; count: number }[];
  avgScore: number;
  blockedTransactions: number;
  falsePositiveRate: number;
}> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const where = { created_at: { gte: since } };

  const [totalAlerts, byLevel, byStatus, avgScore, blocked, resolved] = await Promise.all([
    prisma.fraud_alerts.count({ where }),
    prisma.fraud_alerts.groupBy({
      by: ['risk_level'],
      where,
      _count: true,
    }),
    prisma.fraud_alerts.groupBy({
      by: ['status'],
      where,
      _count: true,
    }),
    prisma.fraud_alerts.aggregate({
      where,
      _avg: { risk_score: true },
    }),
    prisma.fraud_alerts.count({ where: { ...where, auto_blocked: true } }),
    prisma.fraud_alerts.count({ where: { ...where, status: { in: ['RESOLVED', 'FALSE_POSITIVE'] } } }),
  ]);

  const falsePositives = await prisma.fraud_alerts.count({
    where: { ...where, status: 'FALSE_POSITIVE' },
  });

  return {
    totalAlerts,
    byLevel: byLevel.map(l => ({ level: l.risk_level, count: l._count })),
    byStatus: byStatus.map(s => ({ status: s.status, count: s._count })),
    avgScore: avgScore._avg.risk_score || 0,
    blockedTransactions: blocked,
    falsePositiveRate: resolved > 0 ? (falsePositives / resolved) * 100 : 0,
  };
}

// ============================================
// BLACKLIST MANAGEMENT
// ============================================

/**
 * Agregar IP a lista negra
 */
async function blacklistIP(ip: string, reason: string, employeeId: string): Promise<any> {
  const entry = await prisma.blacklisted_ips.create({
    data: {
      ip,
      reason,
      added_by: employeeId,
    },
  });

  await auditLogService.log({
    actorType: 'employee',
    actorId: employeeId,
    action: 'create',
    resource: 'blacklisted_ips',
    resourceId: entry.id,
    description: `IP agregada a lista negra: ${ip}`,
    newData: { ip, reason },
  });

  return entry;
}

/**
 * Remover IP de lista negra
 */
async function removeIPFromBlacklist(ip: string, employeeId: string): Promise<void> {
  await prisma.blacklisted_ips.delete({
    where: { ip },
  });

  await auditLogService.log({
    actorType: 'employee',
    actorId: employeeId,
    action: 'delete',
    resource: 'blacklisted_ips',
    description: `IP removida de lista negra: ${ip}`,
  });
}

// ============================================
// EXPORTS
// ============================================

export const fraudService = {
  // Scoring
  evaluateTransaction,
  
  // Alerts
  createAlert,
  listAlerts,
  reviewAlert,
  getStats,
  
  // Blacklist
  blacklistIP,
  removeIPFromBlacklist,
};
