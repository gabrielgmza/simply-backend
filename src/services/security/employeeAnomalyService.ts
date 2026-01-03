import { PrismaClient } from '@prisma/client';
import { auditLogService } from '../backoffice/auditLogService';

const prisma = new PrismaClient();

// ============================================
// EMPLOYEE ANOMALY DETECTION SERVICE
// Detecta comportamiento sospechoso de empleados
// ============================================

export type AnomalyType = 
  | 'OFF_HOURS_ACCESS'         // Acceso fuera de horario
  | 'BULK_DATA_ACCESS'         // Acceso masivo a datos
  | 'UNASSIGNED_CLIENT_ACCESS' // Acceso a cliente no asignado
  | 'UNUSUAL_APPROVAL_PATTERN' // Patrón de aprobaciones inusual
  | 'DATA_EXPORT_SPIKE'        // Exportación excesiva de datos
  | 'PRIVILEGE_ESCALATION'     // Intento de escalación
  | 'REPEATED_SENSITIVE_ACCESS'// Acceso repetido a datos sensibles
  | 'MODIFICATION_WITHOUT_TICKET'// Cambio sin ticket asociado
  | 'VELOCITY_ANOMALY'         // Velocidad anómala de acciones
  | 'GEO_ANOMALY';             // Ubicación geográfica inusual

export type AnomalySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface EmployeeAnomaly {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  
  anomalyType: AnomalyType;
  severity: AnomalySeverity;
  
  description: string;
  details: Record<string, any>;
  
  // Baseline vs actual
  baseline?: any;
  actual?: any;
  deviationPercent?: number;
  
  // Contexto
  ipAddress: string;
  userAgent?: string;
  sessionId?: string;
  
  // Estado
  status: 'DETECTED' | 'INVESTIGATING' | 'FALSE_POSITIVE' | 'CONFIRMED' | 'RESOLVED';
  
  // Acciones tomadas
  actionsTaken: AnomalyAction[];
  
  detectedAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
}

interface AnomalyAction {
  action: 'ALERT_SENT' | 'SESSION_TERMINATED' | 'ACCESS_BLOCKED' | 'DUAL_APPROVAL_REQUIRED' | 'SUPERVISOR_NOTIFIED';
  timestamp: Date;
  performedBy: string;
  details?: string;
}

interface EmployeeBaseline {
  employeeId: string;
  
  // Horarios normales
  normalWorkHours: { start: number; end: number }; // 9-18
  normalWorkDays: number[];                         // 1-5 (lun-vie)
  
  // Volumen de acciones
  avgDailyActions: number;
  avgDailyDataAccess: number;
  avgDailyApprovals: number;
  avgDailyExports: number;
  
  // Clientes
  assignedClientIds: string[];
  avgClientsAccessedDaily: number;
  
  // IPs conocidas
  knownIPs: string[];
  
  // Última actualización
  lastUpdated: Date;
}

// Thresholds de anomalía
const ANOMALY_THRESHOLDS = {
  OFF_HOURS_ACCESS: { severity: 'MEDIUM' as AnomalySeverity },
  BULK_DATA_ACCESS: { threshold: 3, severity: 'HIGH' as AnomalySeverity },
  UNASSIGNED_CLIENT_ACCESS: { severity: 'MEDIUM' as AnomalySeverity },
  UNUSUAL_APPROVAL_PATTERN: { threshold: 2, severity: 'HIGH' as AnomalySeverity },
  DATA_EXPORT_SPIKE: { threshold: 5, severity: 'HIGH' as AnomalySeverity },
  PRIVILEGE_ESCALATION: { severity: 'CRITICAL' as AnomalySeverity },
  REPEATED_SENSITIVE_ACCESS: { threshold: 5, severity: 'MEDIUM' as AnomalySeverity },
  MODIFICATION_WITHOUT_TICKET: { severity: 'MEDIUM' as AnomalySeverity },
  VELOCITY_ANOMALY: { threshold: 3, severity: 'HIGH' as AnomalySeverity },
  GEO_ANOMALY: { severity: 'HIGH' as AnomalySeverity }
};

export const employeeAnomalyService = {
  // ==========================================
  // ANALIZAR ACCIÓN DE EMPLEADO EN TIEMPO REAL
  // ==========================================

  async analyzeAction(params: {
    employeeId: string;
    action: string;
    resource: string;
    resourceId?: string;
    ipAddress: string;
    userAgent?: string;
    sessionId?: string;
    metadata?: Record<string, any>;
  }): Promise<EmployeeAnomaly[]> {
    const anomalies: EmployeeAnomaly[] = [];

    // Obtener empleado
    const employee = await prisma.employees.findUnique({
      where: { id: params.employeeId }
    });

    if (!employee) return anomalies;

    // Obtener o crear baseline
    const baseline = await this.getOrCreateBaseline(params.employeeId);

    // Ejecutar todas las detecciones
    const checks = await Promise.all([
      this.checkOffHoursAccess(params, employee, baseline),
      this.checkBulkDataAccess(params, employee, baseline),
      this.checkUnassignedClientAccess(params, employee, baseline),
      this.checkApprovalPattern(params, employee, baseline),
      this.checkDataExportSpike(params, employee, baseline),
      this.checkVelocityAnomaly(params, employee, baseline),
      this.checkGeoAnomaly(params, employee, baseline),
      this.checkSensitiveDataAccess(params, employee, baseline)
    ]);

    // Recolectar anomalías detectadas
    for (const check of checks) {
      if (check) {
        anomalies.push(check);
      }
    }

    // Guardar y tomar acciones si hay anomalías
    for (const anomaly of anomalies) {
      await this.saveAnomaly(anomaly);
      await this.takeAutomaticActions(anomaly);
    }

    return anomalies;
  },

  // ==========================================
  // DETECCIONES ESPECÍFICAS
  // ==========================================

  async checkOffHoursAccess(
    params: any,
    employee: any,
    baseline: EmployeeBaseline
  ): Promise<EmployeeAnomaly | null> {
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay(); // 0 = domingo

    // Verificar si está fuera del horario normal
    const isOffHours = hour < baseline.normalWorkHours.start || hour > baseline.normalWorkHours.end;
    const isWeekend = !baseline.normalWorkDays.includes(dayOfWeek);

    if (isOffHours || isWeekend) {
      return this.createAnomaly({
        employeeId: params.employeeId,
        employeeName: `${employee.first_name} ${employee.last_name}`,
        employeeRole: employee.role,
        anomalyType: 'OFF_HOURS_ACCESS',
        severity: ANOMALY_THRESHOLDS.OFF_HOURS_ACCESS.severity,
        description: `Acceso fuera de horario laboral (${hour}:00, ${isWeekend ? 'fin de semana' : 'día hábil'})`,
        details: {
          accessTime: now.toISOString(),
          hour,
          dayOfWeek,
          isWeekend,
          action: params.action
        },
        baseline: baseline.normalWorkHours,
        actual: { hour, dayOfWeek },
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        sessionId: params.sessionId
      });
    }

    return null;
  },

  async checkBulkDataAccess(
    params: any,
    employee: any,
    baseline: EmployeeBaseline
  ): Promise<EmployeeAnomaly | null> {
    // Contar accesos a datos en la última hora
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const recentAccess = await prisma.audit_logs.count({
      where: {
        actor_id: params.employeeId,
        action: { contains: 'VIEW' },
        created_at: { gte: oneHourAgo }
      }
    });

    const threshold = baseline.avgDailyDataAccess * ANOMALY_THRESHOLDS.BULK_DATA_ACCESS.threshold;

    if (recentAccess > threshold) {
      return this.createAnomaly({
        employeeId: params.employeeId,
        employeeName: `${employee.first_name} ${employee.last_name}`,
        employeeRole: employee.role,
        anomalyType: 'BULK_DATA_ACCESS',
        severity: ANOMALY_THRESHOLDS.BULK_DATA_ACCESS.severity,
        description: `Acceso masivo a datos: ${recentAccess} consultas en 1 hora (promedio diario: ${baseline.avgDailyDataAccess})`,
        details: {
          recentAccessCount: recentAccess,
          timeWindowMinutes: 60
        },
        baseline: baseline.avgDailyDataAccess,
        actual: recentAccess,
        deviationPercent: ((recentAccess - baseline.avgDailyDataAccess) / baseline.avgDailyDataAccess) * 100,
        ipAddress: params.ipAddress,
        sessionId: params.sessionId
      });
    }

    return null;
  },

  async checkUnassignedClientAccess(
    params: any,
    employee: any,
    baseline: EmployeeBaseline
  ): Promise<EmployeeAnomaly | null> {
    // Solo aplica si accede a datos de usuario específico
    if (params.resource !== 'user' || !params.resourceId) return null;

    // Verificar si es cliente asignado
    const isAssigned = baseline.assignedClientIds.includes(params.resourceId);

    if (!isAssigned) {
      // Verificar si es soporte (puede acceder a cualquier cliente)
      if (employee.role === 'CUSTOMER_SERVICE' || employee.role === 'SUPER_ADMIN') {
        return null;
      }

      return this.createAnomaly({
        employeeId: params.employeeId,
        employeeName: `${employee.first_name} ${employee.last_name}`,
        employeeRole: employee.role,
        anomalyType: 'UNASSIGNED_CLIENT_ACCESS',
        severity: ANOMALY_THRESHOLDS.UNASSIGNED_CLIENT_ACCESS.severity,
        description: `Acceso a cliente no asignado: ${params.resourceId}`,
        details: {
          clientId: params.resourceId,
          action: params.action,
          assignedClients: baseline.assignedClientIds.length
        },
        ipAddress: params.ipAddress,
        sessionId: params.sessionId
      });
    }

    return null;
  },

  async checkApprovalPattern(
    params: any,
    employee: any,
    baseline: EmployeeBaseline
  ): Promise<EmployeeAnomaly | null> {
    // Solo si es una acción de aprobación
    if (!params.action.toLowerCase().includes('approve')) return null;

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const recentApprovals = await prisma.audit_logs.count({
      where: {
        actor_id: params.employeeId,
        action: { contains: 'APPROVE' },
        created_at: { gte: oneHourAgo }
      }
    });

    const threshold = baseline.avgDailyApprovals * ANOMALY_THRESHOLDS.UNUSUAL_APPROVAL_PATTERN.threshold;

    if (recentApprovals > threshold && recentApprovals >= 5) {
      // Verificar si son aprobaciones de alto valor
      const highValueApprovals = await prisma.audit_logs.count({
        where: {
          actor_id: params.employeeId,
          action: { contains: 'APPROVE' },
          created_at: { gte: oneHourAgo },
          metadata: {
            path: ['amount'],
            gte: 1000000
          }
        }
      });

      return this.createAnomaly({
        employeeId: params.employeeId,
        employeeName: `${employee.first_name} ${employee.last_name}`,
        employeeRole: employee.role,
        anomalyType: 'UNUSUAL_APPROVAL_PATTERN',
        severity: highValueApprovals > 0 ? 'CRITICAL' : ANOMALY_THRESHOLDS.UNUSUAL_APPROVAL_PATTERN.severity,
        description: `Patrón de aprobaciones inusual: ${recentApprovals} en 1 hora (${highValueApprovals} de alto valor)`,
        details: {
          recentApprovals,
          highValueApprovals,
          avgDaily: baseline.avgDailyApprovals
        },
        baseline: baseline.avgDailyApprovals,
        actual: recentApprovals,
        deviationPercent: ((recentApprovals - baseline.avgDailyApprovals) / baseline.avgDailyApprovals) * 100,
        ipAddress: params.ipAddress,
        sessionId: params.sessionId
      });
    }

    return null;
  },

  async checkDataExportSpike(
    params: any,
    employee: any,
    baseline: EmployeeBaseline
  ): Promise<EmployeeAnomaly | null> {
    // Solo si es exportación
    if (!params.action.toLowerCase().includes('export')) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayExports = await prisma.audit_logs.count({
      where: {
        actor_id: params.employeeId,
        action: { contains: 'EXPORT' },
        created_at: { gte: today }
      }
    });

    const threshold = Math.max(baseline.avgDailyExports * ANOMALY_THRESHOLDS.DATA_EXPORT_SPIKE.threshold, 3);

    if (todayExports >= threshold) {
      return this.createAnomaly({
        employeeId: params.employeeId,
        employeeName: `${employee.first_name} ${employee.last_name}`,
        employeeRole: employee.role,
        anomalyType: 'DATA_EXPORT_SPIKE',
        severity: ANOMALY_THRESHOLDS.DATA_EXPORT_SPIKE.severity,
        description: `Exportación excesiva: ${todayExports} hoy (promedio: ${baseline.avgDailyExports})`,
        details: {
          todayExports,
          avgDaily: baseline.avgDailyExports,
          lastExport: params.metadata
        },
        baseline: baseline.avgDailyExports,
        actual: todayExports,
        ipAddress: params.ipAddress,
        sessionId: params.sessionId
      });
    }

    return null;
  },

  async checkVelocityAnomaly(
    params: any,
    employee: any,
    baseline: EmployeeBaseline
  ): Promise<EmployeeAnomaly | null> {
    // Acciones en los últimos 5 minutos
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const recentActions = await prisma.audit_logs.count({
      where: {
        actor_id: params.employeeId,
        created_at: { gte: fiveMinutesAgo }
      }
    });

    // Más de 50 acciones en 5 min es sospechoso (posible script/bot)
    if (recentActions > 50) {
      return this.createAnomaly({
        employeeId: params.employeeId,
        employeeName: `${employee.first_name} ${employee.last_name}`,
        employeeRole: employee.role,
        anomalyType: 'VELOCITY_ANOMALY',
        severity: ANOMALY_THRESHOLDS.VELOCITY_ANOMALY.severity,
        description: `Velocidad anómala: ${recentActions} acciones en 5 minutos (posible automatización)`,
        details: {
          actionsIn5Min: recentActions,
          actionsPerSecond: recentActions / 300
        },
        ipAddress: params.ipAddress,
        sessionId: params.sessionId
      });
    }

    return null;
  },

  async checkGeoAnomaly(
    params: any,
    employee: any,
    baseline: EmployeeBaseline
  ): Promise<EmployeeAnomaly | null> {
    // Verificar si la IP es conocida
    if (baseline.knownIPs.includes(params.ipAddress)) {
      return null;
    }

    // Es una IP nueva, verificar si hay sesión reciente desde otra ubicación
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const recentSessions = await prisma.employee_sessions.findMany({
      where: {
        employee_id: params.employeeId,
        created_at: { gte: oneHourAgo }
      },
      orderBy: { created_at: 'desc' },
      take: 5
    });

    const differentIPs = new Set(recentSessions.map(s => s.ip_address));
    
    if (differentIPs.size >= 3) {
      return this.createAnomaly({
        employeeId: params.employeeId,
        employeeName: `${employee.first_name} ${employee.last_name}`,
        employeeRole: employee.role,
        anomalyType: 'GEO_ANOMALY',
        severity: ANOMALY_THRESHOLDS.GEO_ANOMALY.severity,
        description: `Múltiples ubicaciones en 1 hora: ${differentIPs.size} IPs diferentes`,
        details: {
          currentIP: params.ipAddress,
          recentIPs: Array.from(differentIPs),
          knownIPs: baseline.knownIPs
        },
        ipAddress: params.ipAddress,
        sessionId: params.sessionId
      });
    }

    return null;
  },

  async checkSensitiveDataAccess(
    params: any,
    employee: any,
    baseline: EmployeeBaseline
  ): Promise<EmployeeAnomaly | null> {
    // Campos sensibles
    const sensitiveFields = ['password', 'dni', 'cvu', 'balance', 'cuil', 'income'];
    const sensitiveResources = ['kyc_documents', 'fraud_alerts', 'risk_flags'];

    const isSensitive = sensitiveFields.some(f => params.action.toLowerCase().includes(f)) ||
                        sensitiveResources.includes(params.resource);

    if (!isSensitive) return null;

    // Contar accesos a datos sensibles hoy
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const sensitiveAccess = await prisma.audit_logs.count({
      where: {
        actor_id: params.employeeId,
        created_at: { gte: today },
        OR: [
          { resource: { in: sensitiveResources } },
          { action: { contains: 'SENSITIVE' } }
        ]
      }
    });

    if (sensitiveAccess >= ANOMALY_THRESHOLDS.REPEATED_SENSITIVE_ACCESS.threshold) {
      return this.createAnomaly({
        employeeId: params.employeeId,
        employeeName: `${employee.first_name} ${employee.last_name}`,
        employeeRole: employee.role,
        anomalyType: 'REPEATED_SENSITIVE_ACCESS',
        severity: ANOMALY_THRESHOLDS.REPEATED_SENSITIVE_ACCESS.severity,
        description: `Acceso repetido a datos sensibles: ${sensitiveAccess} veces hoy`,
        details: {
          sensitiveAccessCount: sensitiveAccess,
          currentAccess: {
            resource: params.resource,
            action: params.action
          }
        },
        ipAddress: params.ipAddress,
        sessionId: params.sessionId
      });
    }

    return null;
  },

  // ==========================================
  // HELPERS
  // ==========================================

  createAnomaly(data: Partial<EmployeeAnomaly>): EmployeeAnomaly {
    return {
      id: crypto.randomUUID(),
      employeeId: data.employeeId!,
      employeeName: data.employeeName!,
      employeeRole: data.employeeRole!,
      anomalyType: data.anomalyType!,
      severity: data.severity!,
      description: data.description!,
      details: data.details || {},
      baseline: data.baseline,
      actual: data.actual,
      deviationPercent: data.deviationPercent,
      ipAddress: data.ipAddress!,
      userAgent: data.userAgent,
      sessionId: data.sessionId,
      status: 'DETECTED',
      actionsTaken: [],
      detectedAt: new Date()
    };
  },

  async saveAnomaly(anomaly: EmployeeAnomaly): Promise<void> {
    await prisma.employee_anomalies.create({
      data: {
        id: anomaly.id,
        employee_id: anomaly.employeeId,
        anomaly_type: anomaly.anomalyType,
        severity: anomaly.severity,
        description: anomaly.description,
        details: anomaly.details as any,
        baseline: anomaly.baseline as any,
        actual: anomaly.actual as any,
        deviation_percent: anomaly.deviationPercent,
        ip_address: anomaly.ipAddress,
        user_agent: anomaly.userAgent,
        session_id: anomaly.sessionId,
        status: anomaly.status,
        actions_taken: anomaly.actionsTaken as any,
        detected_at: anomaly.detectedAt
      }
    });
  },

  async takeAutomaticActions(anomaly: EmployeeAnomaly): Promise<void> {
    const actions: AnomalyAction[] = [];

    // Acciones según severidad
    switch (anomaly.severity) {
      case 'CRITICAL':
        // Terminar sesión inmediatamente
        if (anomaly.sessionId) {
          await prisma.employee_sessions.updateMany({
            where: { id: anomaly.sessionId },
            data: { is_valid: false, invalidated_reason: `anomaly_${anomaly.anomalyType}` }
          });
          actions.push({
            action: 'SESSION_TERMINATED',
            timestamp: new Date(),
            performedBy: 'system',
            details: 'Sesión terminada automáticamente por anomalía crítica'
          });
        }

        // Notificar supervisor y admin
        await this.notifySupervisor(anomaly);
        actions.push({
          action: 'SUPERVISOR_NOTIFIED',
          timestamp: new Date(),
          performedBy: 'system'
        });
        break;

      case 'HIGH':
        // Requerir dual approval para próximas acciones
        await prisma.employees.update({
          where: { id: anomaly.employeeId },
          data: {
            requires_dual_approval: true,
            dual_approval_reason: `anomaly_${anomaly.anomalyType}`
          }
        });
        actions.push({
          action: 'DUAL_APPROVAL_REQUIRED',
          timestamp: new Date(),
          performedBy: 'system'
        });
        break;

      case 'MEDIUM':
      case 'LOW':
        // Solo alertar
        actions.push({
          action: 'ALERT_SENT',
          timestamp: new Date(),
          performedBy: 'system'
        });
        break;
    }

    // Actualizar anomalía con acciones
    await prisma.employee_anomalies.update({
      where: { id: anomaly.id },
      data: { actions_taken: actions as any }
    });

    // Audit log
    await auditLogService.log({
      action: 'EMPLOYEE_ANOMALY_DETECTED',
      actorType: 'system',
      resource: 'employee',
      resourceId: anomaly.employeeId,
      description: `[${anomaly.severity}] ${anomaly.anomalyType}: ${anomaly.description}`,
      severity: anomaly.severity,
      metadata: anomaly
    });
  },

  async notifySupervisor(anomaly: EmployeeAnomaly): Promise<void> {
    // Obtener supervisor
    const employee = await prisma.employees.findUnique({
      where: { id: anomaly.employeeId },
      select: { supervisor_id: true }
    });

    if (employee?.supervisor_id) {
      // TODO: Enviar notificación real (email, push, etc.)
      console.log(`🚨 Notificar supervisor ${employee.supervisor_id} sobre anomalía de ${anomaly.employeeId}`);
    }

    // También notificar a admins
    const admins = await prisma.employees.findMany({
      where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] }, status: 'ACTIVE' }
    });

    for (const admin of admins) {
      console.log(`🚨 Notificar admin ${admin.id} sobre anomalía crítica`);
    }
  },

  async getOrCreateBaseline(employeeId: string): Promise<EmployeeBaseline> {
    // Buscar baseline existente
    const existing = await prisma.employee_baselines.findUnique({
      where: { employee_id: employeeId }
    });

    if (existing && Date.now() - existing.updated_at.getTime() < 24 * 60 * 60 * 1000) {
      return existing as unknown as EmployeeBaseline;
    }

    // Calcular baseline
    const baseline = await this.calculateBaseline(employeeId);

    // Guardar
    await prisma.employee_baselines.upsert({
      where: { employee_id: employeeId },
      create: {
        employee_id: employeeId,
        ...baseline,
        updated_at: new Date()
      },
      update: {
        ...baseline,
        updated_at: new Date()
      }
    });

    return { ...baseline, employeeId, lastUpdated: new Date() };
  },

  async calculateBaseline(employeeId: string): Promise<Omit<EmployeeBaseline, 'employeeId' | 'lastUpdated'>> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Horarios de acceso
    const sessions = await prisma.employee_sessions.findMany({
      where: {
        employee_id: employeeId,
        created_at: { gte: thirtyDaysAgo }
      },
      select: { created_at: true }
    });

    const hours = sessions.map(s => s.created_at.getHours());
    const days = sessions.map(s => s.created_at.getDay());

    // Calcular horario normal (percentil 10 y 90)
    hours.sort((a, b) => a - b);
    const startHour = hours[Math.floor(hours.length * 0.1)] || 9;
    const endHour = hours[Math.floor(hours.length * 0.9)] || 18;

    // Días normales
    const dayFreq = days.reduce((acc, d) => { acc[d] = (acc[d] || 0) + 1; return acc; }, {} as Record<number, number>);
    const normalDays = Object.entries(dayFreq)
      .filter(([_, count]) => count > sessions.length * 0.1)
      .map(([day]) => parseInt(day));

    // Métricas de actividad
    const logs = await prisma.audit_logs.findMany({
      where: {
        actor_id: employeeId,
        created_at: { gte: thirtyDaysAgo }
      }
    });

    const daysWithActivity = new Set(logs.map(l => l.created_at.toDateString())).size || 1;

    const dataAccessLogs = logs.filter(l => l.action.includes('VIEW'));
    const approvalLogs = logs.filter(l => l.action.includes('APPROVE'));
    const exportLogs = logs.filter(l => l.action.includes('EXPORT'));

    // IPs conocidas
    const ips = await prisma.employee_sessions.findMany({
      where: { employee_id: employeeId },
      distinct: ['ip_address'],
      select: { ip_address: true }
    });

    return {
      normalWorkHours: { start: startHour, end: endHour },
      normalWorkDays: normalDays.length > 0 ? normalDays : [1, 2, 3, 4, 5],
      avgDailyActions: logs.length / daysWithActivity,
      avgDailyDataAccess: dataAccessLogs.length / daysWithActivity,
      avgDailyApprovals: approvalLogs.length / daysWithActivity,
      avgDailyExports: exportLogs.length / daysWithActivity,
      assignedClientIds: [], // TODO: Obtener de sistema de asignación
      avgClientsAccessedDaily: 0,
      knownIPs: ips.map(i => i.ip_address)
    };
  },

  // ==========================================
  // API
  // ==========================================

  async getAnomalies(params: {
    employeeId?: string;
    status?: string;
    severity?: string;
    from?: Date;
    to?: Date;
    limit?: number;
  }) {
    return prisma.employee_anomalies.findMany({
      where: {
        ...(params.employeeId && { employee_id: params.employeeId }),
        ...(params.status && { status: params.status }),
        ...(params.severity && { severity: params.severity }),
        ...(params.from && { detected_at: { gte: params.from } }),
        ...(params.to && { detected_at: { lte: params.to } })
      },
      orderBy: { detected_at: 'desc' },
      take: params.limit || 50,
      include: {
        employee: {
          select: { first_name: true, last_name: true, role: true }
        }
      }
    });
  },

  async updateAnomalyStatus(anomalyId: string, status: string, resolvedBy?: string) {
    return prisma.employee_anomalies.update({
      where: { id: anomalyId },
      data: {
        status,
        ...(status === 'RESOLVED' && {
          resolved_at: new Date(),
          resolved_by: resolvedBy
        })
      }
    });
  }
};

import crypto from 'crypto';
