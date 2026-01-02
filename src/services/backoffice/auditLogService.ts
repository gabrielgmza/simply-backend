import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface AuditLogEntry {
  actorType: 'employee' | 'user' | 'system';
  actorId?: string;
  actorEmail?: string;
  actorRole?: string;
  action: string;
  resource: string;
  resourceId?: string;
  description: string;
  oldData?: any;
  newData?: any;
  metadata?: any;
  ipAddress?: string;
  userAgent?: string;
  status?: 'success' | 'failed' | 'blocked';
  errorMessage?: string;
}

export const auditLogService = {
  // ============================================
  // CREAR LOG
  // ============================================
  async log(entry: AuditLogEntry) {
    try {
      await prisma.audit_logs.create({
        data: {
          actor_type: entry.actorType,
          actor_id: entry.actorId,
          actor_email: entry.actorEmail,
          actor_role: entry.actorRole,
          action: entry.action,
          resource: entry.resource,
          resource_id: entry.resourceId,
          description: entry.description,
          old_data: entry.oldData,
          new_data: entry.newData,
          metadata: entry.metadata,
          ip_address: entry.ipAddress,
          user_agent: entry.userAgent,
          status: entry.status || 'success',
          error_message: entry.errorMessage
        }
      });
    } catch (error) {
      console.error('Error creating audit log:', error);
      // No lanzamos error para no interrumpir la operación principal
    }
  },

  // ============================================
  // HELPERS PARA ACCIONES COMUNES
  // ============================================
  
  // Login
  async logLogin(employeeId: string, email: string, role: string, ip?: string, userAgent?: string) {
    await this.log({
      actorType: 'employee',
      actorId: employeeId,
      actorEmail: email,
      actorRole: role,
      action: 'login',
      resource: 'auth',
      description: `Inicio de sesión: ${email}`,
      ipAddress: ip,
      userAgent: userAgent
    });
  },

  // Logout
  async logLogout(employeeId: string, email: string) {
    await this.log({
      actorType: 'employee',
      actorId: employeeId,
      actorEmail: email,
      action: 'logout',
      resource: 'auth',
      description: `Cierre de sesión: ${email}`
    });
  },

  // Cambio de configuración
  async logSettingChange(
    employeeId: string,
    employeeEmail: string,
    settingKey: string,
    oldValue: any,
    newValue: any,
    reason?: string
  ) {
    await this.log({
      actorType: 'employee',
      actorId: employeeId,
      actorEmail: employeeEmail,
      action: 'update',
      resource: 'system_settings',
      resourceId: settingKey,
      description: `Cambio de configuración: ${settingKey}`,
      oldData: { value: oldValue },
      newData: { value: newValue },
      metadata: { reason }
    });
  },

  // Acción sobre usuario
  async logUserAction(
    employeeId: string,
    employeeEmail: string,
    action: string,
    userId: string,
    description: string,
    oldData?: any,
    newData?: any
  ) {
    await this.log({
      actorType: 'employee',
      actorId: employeeId,
      actorEmail: employeeEmail,
      action,
      resource: 'users',
      resourceId: userId,
      description,
      oldData,
      newData
    });
  },

  // Acción sobre inversión
  async logInvestmentAction(
    employeeId: string,
    employeeEmail: string,
    action: string,
    investmentId: string,
    userId: string,
    description: string,
    details?: any
  ) {
    await this.log({
      actorType: 'employee',
      actorId: employeeId,
      actorEmail: employeeEmail,
      action,
      resource: 'investments',
      resourceId: investmentId,
      description,
      metadata: { userId, ...details }
    });
  },

  // Acción sobre financiación
  async logFinancingAction(
    employeeId: string,
    employeeEmail: string,
    action: string,
    financingId: string,
    userId: string,
    description: string,
    details?: any
  ) {
    await this.log({
      actorType: 'employee',
      actorId: employeeId,
      actorEmail: employeeEmail,
      action,
      resource: 'financings',
      resourceId: financingId,
      description,
      metadata: { userId, ...details }
    });
  },

  // Acción de tesorería
  async logTreasuryAction(
    employeeId: string,
    action: string,
    accountId: string,
    oldData?: any,
    newData?: any
  ) {
    await this.log({
      actorType: 'employee',
      actorId: employeeId,
      action,
      resource: 'internal_accounts',
      resourceId: accountId,
      description: `Operación de tesorería: ${action}`,
      oldData,
      newData
    });
  },

  // Acción de OTC
  async logOTCAction(
    employeeId: string,
    action: string,
    operationId: string,
    details?: any
  ) {
    await this.log({
      actorType: 'employee',
      actorId: employeeId,
      action,
      resource: 'otc_operations',
      resourceId: operationId,
      description: `Operación OTC: ${action}`,
      newData: details
    });
  },

  // Acción de fraude
  async logFraudAction(
    actorType: 'employee' | 'system',
    actorId: string | undefined,
    action: string,
    alertId: string,
    details?: any
  ) {
    await this.log({
      actorType,
      actorId,
      action,
      resource: 'fraud_alerts',
      resourceId: alertId,
      description: `Acción de fraude: ${action}`,
      newData: details
    });
  },

  // Acción de compliance
  async logComplianceAction(
    employeeId: string,
    action: string,
    reportId: string,
    details?: any
  ) {
    await this.log({
      actorType: 'employee',
      actorId: employeeId,
      action,
      resource: 'compliance_reports',
      resourceId: reportId,
      description: `Acción de compliance: ${action}`,
      newData: details
    });
  },

  // ============================================
  // CONSULTAS
  // ============================================
  
  async getAll(options: {
    page?: number;
    limit?: number;
    actorType?: string;
    actorId?: string;
    action?: string;
    resource?: string;
    resourceId?: string;
    dateFrom?: Date;
    dateTo?: Date;
    status?: string;
  }) {
    const { 
      page = 1, 
      limit = 50, 
      actorType, 
      actorId, 
      action, 
      resource, 
      resourceId,
      dateFrom,
      dateTo,
      status
    } = options;
    
    const skip = (page - 1) * limit;
    const where: any = {};

    if (actorType) where.actor_type = actorType;
    if (actorId) where.actor_id = actorId;
    if (action) where.action = action;
    if (resource) where.resource = resource;
    if (resourceId) where.resource_id = resourceId;
    if (status) where.status = status;

    if (dateFrom || dateTo) {
      where.created_at = {};
      if (dateFrom) where.created_at.gte = dateFrom;
      if (dateTo) where.created_at.lte = dateTo;
    }

    const [logs, total] = await Promise.all([
      prisma.audit_logs.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' }
      }),
      prisma.audit_logs.count({ where })
    ]);

    return {
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  },

  async getByResource(resource: string, resourceId: string, limit = 50) {
    return prisma.audit_logs.findMany({
      where: {
        resource,
        resource_id: resourceId
      },
      orderBy: { created_at: 'desc' },
      take: limit
    });
  },

  async getByActor(actorId: string, limit = 50) {
    return prisma.audit_logs.findMany({
      where: { actor_id: actorId },
      orderBy: { created_at: 'desc' },
      take: limit
    });
  },

  async getRecent(limit = 100) {
    return prisma.audit_logs.findMany({
      orderBy: { created_at: 'desc' },
      take: limit
    });
  },

  // Stats para dashboard
  async getStats(days = 7) {
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - days);

    const [total, byAction, byResource, byStatus] = await Promise.all([
      prisma.audit_logs.count({
        where: { created_at: { gte: dateFrom } }
      }),
      prisma.audit_logs.groupBy({
        by: ['action'],
        where: { created_at: { gte: dateFrom } },
        _count: true,
        orderBy: { _count: { action: 'desc' } },
        take: 10
      }),
      prisma.audit_logs.groupBy({
        by: ['resource'],
        where: { created_at: { gte: dateFrom } },
        _count: true,
        orderBy: { _count: { resource: 'desc' } },
        take: 10
      }),
      prisma.audit_logs.groupBy({
        by: ['status'],
        where: { created_at: { gte: dateFrom } },
        _count: true
      })
    ]);

    return {
      total,
      byAction,
      byResource,
      byStatus,
      period: { days, from: dateFrom, to: new Date() }
    };
  }
};
