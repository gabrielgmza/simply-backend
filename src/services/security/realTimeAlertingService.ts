import { PrismaClient } from '@prisma/client';
import { pushNotificationService } from '../pushNotificationService';

const prisma = new PrismaClient();

// ============================================
// REAL-TIME ALERTING SERVICE
// Sistema centralizado de alertas en tiempo real
// ============================================

export type AlertChannel = 'PUSH' | 'SMS' | 'EMAIL' | 'WEBHOOK' | 'TELEGRAM' | 'IN_APP';
export type AlertPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'EMERGENCY';
export type AlertCategory = 
  | 'SECURITY'
  | 'FRAUD'
  | 'COMPLIANCE'
  | 'SYSTEM'
  | 'BUSINESS'
  | 'USER_ACTION';

export interface Alert {
  id: string;
  category: AlertCategory;
  priority: AlertPriority;
  title: string;
  message: string;
  
  // Targeting
  targetType: 'USER' | 'EMPLOYEE' | 'ROLE' | 'TEAM' | 'ALL_ADMINS';
  targetId?: string;
  targetRole?: string;
  
  // Source
  source: string;
  sourceId?: string;
  
  // Data
  data?: Record<string, any>;
  actionUrl?: string;
  
  // Channels
  channels: AlertChannel[];
  
  // Status
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'ACTIONED' | 'EXPIRED';
  
  // Escalation
  escalationLevel: number;
  escalateAfterMinutes?: number;
  escalateTo?: string;
  
  // Timestamps
  createdAt: Date;
  sentAt?: Date;
  readAt?: Date;
  expiresAt?: Date;
}

interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  
  // Trigger conditions
  triggerEvent: string;
  conditions: AlertCondition[];
  
  // Alert config
  category: AlertCategory;
  priority: AlertPriority;
  titleTemplate: string;
  messageTemplate: string;
  channels: AlertChannel[];
  
  // Targeting
  targetType: 'USER' | 'EMPLOYEE' | 'ROLE' | 'TEAM' | 'ALL_ADMINS';
  targetRole?: string;
  
  // Escalation
  escalateAfterMinutes?: number;
  escalateTo?: string;
  
  // Rate limiting
  cooldownMinutes?: number;
  maxPerHour?: number;
}

interface AlertCondition {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';
  value: any;
}

// Configuración de canales por prioridad
const PRIORITY_CHANNELS: Record<AlertPriority, AlertChannel[]> = {
  LOW: ['IN_APP'],
  MEDIUM: ['IN_APP', 'PUSH'],
  HIGH: ['IN_APP', 'PUSH', 'TELEGRAM'],
  CRITICAL: ['IN_APP', 'PUSH', 'TELEGRAM', 'EMAIL'],
  EMERGENCY: ['IN_APP', 'PUSH', 'TELEGRAM', 'EMAIL', 'SMS', 'WEBHOOK']
};

// Tiempo de escalación por prioridad (minutos)
const ESCALATION_TIMES: Record<AlertPriority, number> = {
  LOW: 1440,      // 24 horas
  MEDIUM: 240,    // 4 horas
  HIGH: 60,       // 1 hora
  CRITICAL: 15,   // 15 minutos
  EMERGENCY: 5    // 5 minutos
};

// Cache de alertas recientes para deduplicación
const recentAlerts = new Map<string, Date>();
const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutos

export const realTimeAlertingService = {
  // ==========================================
  // CREAR Y ENVIAR ALERTA
  // ==========================================

  async createAlert(params: {
    category: AlertCategory;
    priority: AlertPriority;
    title: string;
    message: string;
    targetType: 'USER' | 'EMPLOYEE' | 'ROLE' | 'TEAM' | 'ALL_ADMINS';
    targetId?: string;
    targetRole?: string;
    source: string;
    sourceId?: string;
    data?: Record<string, any>;
    actionUrl?: string;
    channels?: AlertChannel[];
    expiresInMinutes?: number;
  }): Promise<Alert> {
    // Deduplicación
    const dedupKey = `${params.category}-${params.source}-${params.sourceId}-${params.targetId}`;
    const lastSent = recentAlerts.get(dedupKey);
    if (lastSent && Date.now() - lastSent.getTime() < DEDUP_WINDOW_MS) {
      throw new Error('Alert duplicada, ignorando');
    }

    // Determinar canales
    const channels = params.channels || PRIORITY_CHANNELS[params.priority];

    // Crear alerta
    const alert: Alert = {
      id: crypto.randomUUID(),
      category: params.category,
      priority: params.priority,
      title: params.title,
      message: params.message,
      targetType: params.targetType,
      targetId: params.targetId,
      targetRole: params.targetRole,
      source: params.source,
      sourceId: params.sourceId,
      data: params.data,
      actionUrl: params.actionUrl,
      channels,
      status: 'PENDING',
      escalationLevel: 0,
      escalateAfterMinutes: ESCALATION_TIMES[params.priority],
      createdAt: new Date(),
      expiresAt: params.expiresInMinutes 
        ? new Date(Date.now() + params.expiresInMinutes * 60 * 1000)
        : undefined
    };

    // Guardar en DB
    await this.saveAlert(alert);

    // Marcar como enviada para deduplicación
    recentAlerts.set(dedupKey, new Date());

    // Enviar por todos los canales
    await this.sendAlert(alert);

    return alert;
  },

  // ==========================================
  // ENVIAR ALERTA POR CANALES
  // ==========================================

  async sendAlert(alert: Alert): Promise<void> {
    const targets = await this.resolveTargets(alert);

    for (const channel of alert.channels) {
      try {
        switch (channel) {
          case 'IN_APP':
            await this.sendInApp(alert, targets);
            break;
          case 'PUSH':
            await this.sendPush(alert, targets);
            break;
          case 'EMAIL':
            await this.sendEmail(alert, targets);
            break;
          case 'SMS':
            await this.sendSMS(alert, targets);
            break;
          case 'TELEGRAM':
            await this.sendTelegram(alert);
            break;
          case 'WEBHOOK':
            await this.sendWebhook(alert);
            break;
        }
      } catch (error) {
        console.error(`Error sending alert via ${channel}:`, error);
      }
    }

    // Actualizar estado
    await prisma.alerts.update({
      where: { id: alert.id },
      data: { status: 'SENT', sent_at: new Date() }
    });
  },

  async resolveTargets(alert: Alert): Promise<{ type: 'user' | 'employee'; id: string; email?: string; phone?: string; fcmToken?: string }[]> {
    const targets: any[] = [];

    switch (alert.targetType) {
      case 'USER':
        if (alert.targetId) {
          const user = await prisma.users.findUnique({
            where: { id: alert.targetId },
            select: { id: true, email: true, phone: true, fcm_token: true }
          });
          if (user) {
            targets.push({ type: 'user', id: user.id, email: user.email, phone: user.phone, fcmToken: user.fcm_token });
          }
        }
        break;

      case 'EMPLOYEE':
        if (alert.targetId) {
          const employee = await prisma.employees.findUnique({
            where: { id: alert.targetId },
            select: { id: true, email: true, phone: true }
          });
          if (employee) {
            targets.push({ type: 'employee', id: employee.id, email: employee.email, phone: employee.phone });
          }
        }
        break;

      case 'ROLE':
        if (alert.targetRole) {
          const employees = await prisma.employees.findMany({
            where: { role: alert.targetRole, status: 'ACTIVE' },
            select: { id: true, email: true, phone: true }
          });
          targets.push(...employees.map(e => ({ type: 'employee', id: e.id, email: e.email, phone: e.phone })));
        }
        break;

      case 'ALL_ADMINS':
        const admins = await prisma.employees.findMany({
          where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] }, status: 'ACTIVE' },
          select: { id: true, email: true, phone: true }
        });
        targets.push(...admins.map(e => ({ type: 'employee', id: e.id, email: e.email, phone: e.phone })));
        break;
    }

    return targets;
  },

  // ==========================================
  // CANALES DE ENVÍO
  // ==========================================

  async sendInApp(alert: Alert, targets: any[]): Promise<void> {
    for (const target of targets) {
      if (target.type === 'user') {
        await prisma.user_notifications.create({
          data: {
            user_id: target.id,
            title: alert.title,
            body: alert.message,
            type: alert.category.toLowerCase(),
            data: {
              alertId: alert.id,
              priority: alert.priority,
              actionUrl: alert.actionUrl,
              ...alert.data
            }
          }
        });
      } else {
        await prisma.employee_notifications.create({
          data: {
            employee_id: target.id,
            title: alert.title,
            body: alert.message,
            type: alert.category.toLowerCase(),
            priority: alert.priority,
            data: {
              alertId: alert.id,
              actionUrl: alert.actionUrl,
              ...alert.data
            }
          }
        });
      }
    }
  },

  async sendPush(alert: Alert, targets: any[]): Promise<void> {
    for (const target of targets) {
      if (target.type === 'user' && target.fcmToken) {
        await pushNotificationService.sendToUser(target.id, {
          title: alert.title,
          body: alert.message,
          data: {
            alertId: alert.id,
            category: alert.category,
            priority: alert.priority,
            actionUrl: alert.actionUrl
          }
        });
      }
    }
  },

  async sendEmail(alert: Alert, targets: any[]): Promise<void> {
    // TODO: Integrar con servicio de email (SendGrid, SES, etc.)
    for (const target of targets) {
      if (target.email) {
        console.log(`📧 EMAIL to ${target.email}: [${alert.priority}] ${alert.title}`);
        // await emailService.send({
        //   to: target.email,
        //   subject: `[${alert.priority}] ${alert.title}`,
        //   template: 'alert',
        //   data: { alert }
        // });
      }
    }
  },

  async sendSMS(alert: Alert, targets: any[]): Promise<void> {
    // Usar AWS SNS para SMS
    const { sendSNSAlert, sendSMS } = await import('../../config/externalServices');
    
    // Para emergencias, enviar a topic SNS (llega a todos los suscriptores)
    if (alert.priority === 'EMERGENCY' || alert.priority === 'CRITICAL') {
      await sendSNSAlert(
        `[${alert.priority}] ${alert.title}\n\n${alert.message}`,
        `Simply Alert: ${alert.title}`,
        'emergency'
      );
    }
    
    // También enviar SMS directo a targets con teléfono
    for (const target of targets) {
      if (target.phone) {
        const message = `[Simply ${alert.priority}] ${alert.title}: ${alert.message}`.substring(0, 160);
        await sendSMS(target.phone, message);
      }
    }
  },

  async sendTelegram(alert: Alert): Promise<void> {
    const { sendTelegramMessage, formatTelegramAlert } = await import('../../config/externalServices');
    
    const message = formatTelegramAlert(
      alert.title,
      alert.priority,
      alert.message,
      alert.data as Record<string, any>
    );
    
    const type = alert.priority === 'EMERGENCY' || alert.priority === 'CRITICAL' 
      ? 'emergency' 
      : 'alert';
    
    await sendTelegramMessage(message, type);
  },

  async sendWebhook(alert: Alert): Promise<void> {
    // TODO: Enviar a webhooks configurados
    const webhooks = await prisma.alert_webhooks.findMany({
      where: { enabled: true, categories: { has: alert.category } }
    });

    for (const webhook of webhooks) {
      console.log(`🔗 WEBHOOK to ${webhook.url}: [${alert.priority}] ${alert.title}`);
      // await fetch(webhook.url, {
      //   method: 'POST',
      //   headers: {
      //     'Content-Type': 'application/json',
      //     'X-Alert-Signature': this.signPayload(alert, webhook.secret)
      //   },
      //   body: JSON.stringify(alert)
      // });
    }
  },

  // ==========================================
  // ALERTAS PREDEFINIDAS
  // ==========================================

  // Security Alerts
  async alertSuspiciousLogin(userId: string, details: { ip: string; device: string; location?: string }) {
    return this.createAlert({
      category: 'SECURITY',
      priority: 'HIGH',
      title: '🔐 Intento de login sospechoso',
      message: `Se detectó un intento de login desde una ubicación o dispositivo inusual.`,
      targetType: 'USER',
      targetId: userId,
      source: 'auth_service',
      sourceId: userId,
      data: details,
      actionUrl: '/security/sessions'
    });
  },

  async alertAccountBlocked(userId: string, reason: string) {
    return this.createAlert({
      category: 'SECURITY',
      priority: 'CRITICAL',
      title: '🚫 Cuenta bloqueada',
      message: `Tu cuenta ha sido bloqueada temporalmente: ${reason}`,
      targetType: 'USER',
      targetId: userId,
      source: 'security_service',
      sourceId: userId,
      data: { reason },
      actionUrl: '/support'
    });
  },

  // Fraud Alerts
  async alertFraudDetected(params: {
    userId: string;
    transactionId?: string;
    fraudScore: number;
    riskLevel: string;
    reason: string;
  }) {
    // Alerta al usuario
    await this.createAlert({
      category: 'FRAUD',
      priority: params.riskLevel === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
      title: '⚠️ Actividad sospechosa detectada',
      message: 'Detectamos actividad inusual en tu cuenta. Si no fuiste vos, contactanos.',
      targetType: 'USER',
      targetId: params.userId,
      source: 'fraud_service',
      sourceId: params.transactionId,
      data: params,
      actionUrl: '/security'
    });

    // Alerta al equipo de fraude
    return this.createAlert({
      category: 'FRAUD',
      priority: params.riskLevel === 'CRITICAL' ? 'EMERGENCY' : 'HIGH',
      title: `🚨 Fraude detectado - Score ${params.fraudScore}`,
      message: `Usuario ${params.userId}: ${params.reason}`,
      targetType: 'ROLE',
      targetRole: 'FRAUD_ANALYST',
      source: 'fraud_service',
      sourceId: params.transactionId,
      data: params,
      actionUrl: `/backoffice/fraud/cases/${params.userId}`
    });
  },

  // Compliance Alerts
  async alertComplianceIssue(params: {
    userId: string;
    issueType: string;
    description: string;
    severity: AlertPriority;
  }) {
    return this.createAlert({
      category: 'COMPLIANCE',
      priority: params.severity,
      title: `📋 Alerta de Compliance: ${params.issueType}`,
      message: params.description,
      targetType: 'ROLE',
      targetRole: 'COMPLIANCE',
      source: 'compliance_service',
      sourceId: params.userId,
      data: params,
      actionUrl: `/backoffice/compliance/users/${params.userId}`
    });
  },

  // System Alerts
  async alertSystemIssue(params: {
    component: string;
    issue: string;
    severity: AlertPriority;
    details?: any;
  }) {
    return this.createAlert({
      category: 'SYSTEM',
      priority: params.severity,
      title: `⚙️ Problema de sistema: ${params.component}`,
      message: params.issue,
      targetType: 'ALL_ADMINS',
      source: params.component,
      data: params.details,
      channels: ['TELEGRAM', 'EMAIL', 'IN_APP']
    });
  },

  async alertKillSwitchActivated(params: {
    scope: string;
    target: string;
    reason: string;
    activatedBy: string;
  }) {
    return this.createAlert({
      category: 'SYSTEM',
      priority: 'EMERGENCY',
      title: '🛑 KILL SWITCH ACTIVADO',
      message: `${params.scope} - ${params.target}: ${params.reason}`,
      targetType: 'ALL_ADMINS',
      source: 'kill_switch',
      data: params,
      channels: ['TELEGRAM', 'SMS', 'EMAIL', 'PUSH', 'IN_APP']
    });
  },

  // Business Alerts
  async alertHighValueTransaction(params: {
    userId: string;
    transactionId: string;
    amount: number;
    type: string;
  }) {
    return this.createAlert({
      category: 'BUSINESS',
      priority: 'MEDIUM',
      title: '💰 Transacción de alto valor',
      message: `${params.type}: $${params.amount.toLocaleString()}`,
      targetType: 'ROLE',
      targetRole: 'FINANCE',
      source: 'transaction_service',
      sourceId: params.transactionId,
      data: params,
      actionUrl: `/backoffice/transactions/${params.transactionId}`
    });
  },

  // ==========================================
  // ESCALACIÓN
  // ==========================================

  async processEscalations(): Promise<number> {
    const now = new Date();

    // Buscar alertas pendientes que necesitan escalación
    const alertsToEscalate = await prisma.alerts.findMany({
      where: {
        status: { in: ['SENT', 'DELIVERED'] },
        escalate_after_minutes: { not: null },
        escalation_level: { lt: 3 }, // Máximo 3 niveles
        created_at: {
          lt: new Date(now.getTime() - 60000) // Al menos 1 minuto de antigüedad
        }
      }
    });

    let escalated = 0;

    for (const alert of alertsToEscalate) {
      const minutesSinceCreated = (now.getTime() - alert.created_at.getTime()) / 60000;
      const shouldEscalate = minutesSinceCreated >= (alert.escalate_after_minutes || 60) * (alert.escalation_level + 1);

      if (shouldEscalate) {
        await this.escalateAlert(alert.id);
        escalated++;
      }
    }

    return escalated;
  },

  async escalateAlert(alertId: string): Promise<void> {
    const alert = await prisma.alerts.findUnique({ where: { id: alertId } });
    if (!alert) return;

    const newLevel = alert.escalation_level + 1;

    // Determinar nuevo target según nivel
    let newTarget: { type: string; role?: string } = { type: 'ALL_ADMINS' };
    
    if (newLevel === 1) {
      newTarget = { type: 'ROLE', role: 'ADMIN' };
    } else if (newLevel === 2) {
      newTarget = { type: 'ROLE', role: 'SUPER_ADMIN' };
    }

    // Actualizar y reenviar
    await prisma.alerts.update({
      where: { id: alertId },
      data: {
        escalation_level: newLevel,
        target_type: newTarget.type,
        target_role: newTarget.role
      }
    });

    // Enviar notificación de escalación
    await this.createAlert({
      category: alert.category as AlertCategory,
      priority: 'HIGH',
      title: `⬆️ ESCALADO (Nivel ${newLevel}): ${alert.title}`,
      message: `Alerta sin atender por ${alert.escalate_after_minutes} minutos. ${alert.message}`,
      targetType: newTarget.type as any,
      targetRole: newTarget.role,
      source: 'escalation_service',
      sourceId: alertId,
      data: { originalAlertId: alertId, escalationLevel: newLevel }
    });
  },

  // ==========================================
  // GESTIÓN DE ALERTAS
  // ==========================================

  async markAsRead(alertId: string, readBy: string): Promise<void> {
    await prisma.alerts.update({
      where: { id: alertId },
      data: { status: 'READ', read_at: new Date(), read_by: readBy }
    });
  },

  async markAsActioned(alertId: string, actionedBy: string, action: string): Promise<void> {
    await prisma.alerts.update({
      where: { id: alertId },
      data: {
        status: 'ACTIONED',
        actioned_at: new Date(),
        actioned_by: actionedBy,
        action_taken: action
      }
    });
  },

  async getAlerts(params: {
    targetType?: string;
    targetId?: string;
    category?: AlertCategory;
    priority?: AlertPriority;
    status?: string;
    from?: Date;
    to?: Date;
    limit?: number;
  }) {
    return prisma.alerts.findMany({
      where: {
        ...(params.targetType && { target_type: params.targetType }),
        ...(params.targetId && { target_id: params.targetId }),
        ...(params.category && { category: params.category }),
        ...(params.priority && { priority: params.priority }),
        ...(params.status && { status: params.status }),
        ...(params.from && { created_at: { gte: params.from } }),
        ...(params.to && { created_at: { lte: params.to } })
      },
      orderBy: { created_at: 'desc' },
      take: params.limit || 50
    });
  },

  async getUnreadCount(targetType: string, targetId: string): Promise<number> {
    return prisma.alerts.count({
      where: {
        target_type: targetType,
        target_id: targetId,
        status: { in: ['SENT', 'DELIVERED'] }
      }
    });
  },

  // ==========================================
  // HELPERS
  // ==========================================

  async saveAlert(alert: Alert): Promise<void> {
    await prisma.alerts.create({
      data: {
        id: alert.id,
        category: alert.category,
        priority: alert.priority,
        title: alert.title,
        message: alert.message,
        target_type: alert.targetType,
        target_id: alert.targetId,
        target_role: alert.targetRole,
        source: alert.source,
        source_id: alert.sourceId,
        data: alert.data as any,
        action_url: alert.actionUrl,
        channels: alert.channels,
        status: alert.status,
        escalation_level: alert.escalationLevel,
        escalate_after_minutes: alert.escalateAfterMinutes,
        escalate_to: alert.escalateTo,
        created_at: alert.createdAt,
        expires_at: alert.expiresAt
      }
    });
  },

  // ==========================================
  // ESTADÍSTICAS
  // ==========================================

  async getStats(period: 'day' | 'week' | 'month' = 'day') {
    const since = new Date();
    if (period === 'day') since.setDate(since.getDate() - 1);
    else if (period === 'week') since.setDate(since.getDate() - 7);
    else since.setMonth(since.getMonth() - 1);

    const [total, byCategory, byPriority, byStatus] = await Promise.all([
      prisma.alerts.count({ where: { created_at: { gte: since } } }),
      prisma.alerts.groupBy({
        by: ['category'],
        where: { created_at: { gte: since } },
        _count: true
      }),
      prisma.alerts.groupBy({
        by: ['priority'],
        where: { created_at: { gte: since } },
        _count: true
      }),
      prisma.alerts.groupBy({
        by: ['status'],
        where: { created_at: { gte: since } },
        _count: true
      })
    ]);

    return {
      total,
      byCategory: Object.fromEntries(byCategory.map(c => [c.category, c._count])),
      byPriority: Object.fromEntries(byPriority.map(p => [p.priority, p._count])),
      byStatus: Object.fromEntries(byStatus.map(s => [s.status, s._count]))
    };
  }
};

import crypto from 'crypto';
