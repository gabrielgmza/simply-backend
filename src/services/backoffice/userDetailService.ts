import { PrismaClient, Prisma } from '@prisma/client';
import { auditLogService } from './auditLogService';

const prisma = new PrismaClient();

export const userDetailService = {
  // ============================================
  // VISTA COMPLETA DE USUARIO
  // ============================================
  async getFullProfile(userId: string) {
    const user = await prisma.users.findUnique({
      where: { id: userId },
      include: {
        account: true,
        passkeys: {
          select: {
            id: true,
            device_name: true,
            device_type: true,
            created_at: true,
            last_used_at: true
          }
        },
        sessions: {
          where: {
            revoked_at: null,
            expires_at: { gt: new Date() }
          },
          select: {
            id: true,
            device_info: true,
            ip_address: true,
            created_at: true
          },
          orderBy: { created_at: 'desc' },
          take: 10
        },
        kyc_documents: {
          orderBy: { created_at: 'desc' }
        }
      }
    });

    if (!user) {
      throw new Error('Usuario no encontrado');
    }

    // Obtener inversiones
    const investments = await prisma.investments.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      include: {
        _count: { select: { financings: true } }
      }
    });

    // Obtener financiaciones
    const financings = await prisma.financings.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      include: {
        installment_records: {
          orderBy: { number: 'asc' }
        }
      }
    });

    // Obtener tarjetas
    const cards = await prisma.cards.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' }
    });

    // Calcular totales
    const activeInvestments = investments.filter(i => i.status === 'ACTIVE');
    const totalInvested = activeInvestments.reduce(
      (sum, i) => sum.add(i.current_value), 
      new Prisma.Decimal(0)
    );
    const totalReturns = activeInvestments.reduce(
      (sum, i) => sum.add(i.returns_earned),
      new Prisma.Decimal(0)
    );
    const totalCreditLimit = activeInvestments.reduce(
      (sum, i) => sum.add(i.credit_limit),
      new Prisma.Decimal(0)
    );
    const totalCreditUsed = activeInvestments.reduce(
      (sum, i) => sum.add(i.credit_used),
      new Prisma.Decimal(0)
    );

    const activeFinancings = financings.filter(f => f.status === 'ACTIVE');
    const totalDebt = activeFinancings.reduce(
      (sum, f) => sum.add(f.remaining),
      new Prisma.Decimal(0)
    );

    const overdueInstallments = financings.flatMap(f => 
      f.installment_records.filter(i => i.status === 'OVERDUE')
    );

    // Risk flags
    const riskFlags = await prisma.risk_flags.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' }
    });

    return {
      // Datos básicos
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        firstName: user.first_name,
        lastName: user.last_name,
        dni: user.dni,
        birthDate: user.birth_date,
        nationality: user.nationality,
        address: user.address_street ? {
          street: user.address_street,
          number: user.address_number,
          city: user.address_city,
          state: user.address_state,
          zip: user.address_zip
        } : null,
        status: user.status,
        kycStatus: user.kyc_status,
        userLevel: user.user_level,
        pointsBalance: user.points_balance,
        lifetimePoints: user.lifetime_points,
        createdAt: user.created_at,
        lastLoginAt: user.last_login_at,
        lastLoginIp: user.last_login_ip
      },

      // Cuenta
      account: user.account ? {
        cvu: user.account.cvu,
        alias: user.account.alias,
        balance: user.account.balance,
        balancePending: user.account.balance_pending,
        dailyLimit: user.account.daily_limit,
        monthlyLimit: user.account.monthly_limit,
        status: user.account.status
      } : null,

      // Resumen financiero
      financialSummary: {
        balance: user.account?.balance || 0,
        totalInvested,
        totalReturns,
        creditLimit: totalCreditLimit,
        creditUsed: totalCreditUsed,
        creditAvailable: totalCreditLimit.sub(totalCreditUsed),
        totalDebt,
        netWorth: (user.account?.balance || new Prisma.Decimal(0)).add(totalInvested).sub(totalDebt)
      },

      // Inversiones
      investments: {
        active: activeInvestments.length,
        total: investments.length,
        list: investments
      },

      // Financiaciones
      financings: {
        active: activeFinancings.length,
        total: financings.length,
        overdueCount: overdueInstallments.length,
        list: financings
      },

      // Tarjetas
      cards: {
        total: cards.length,
        list: cards
      },

      // Seguridad
      security: {
        passkeys: user.passkeys,
        activeSessions: user.sessions,
        kycDocuments: user.kyc_documents
      },

      // Riesgo
      risk: {
        flags: riskFlags,
        hasActiveFlags: riskFlags.some(f => f.status === 'active'),
        overdueInstallments
      }
    };
  },

  // ============================================
  // OBTENER HISTORIAL DE TRANSACCIONES
  // ============================================
  async getTransactionHistory(userId: string, options: {
    page?: number;
    limit?: number;
    type?: string;
    dateFrom?: Date;
    dateTo?: Date;
  }) {
    const { page = 1, limit = 50, type, dateFrom, dateTo } = options;
    const skip = (page - 1) * limit;

    const where: any = { user_id: userId };
    
    if (type) where.type = type;
    if (dateFrom || dateTo) {
      where.created_at = {};
      if (dateFrom) where.created_at.gte = dateFrom;
      if (dateTo) where.created_at.lte = dateTo;
    }

    const [transactions, total] = await Promise.all([
      prisma.transactions.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' }
      }),
      prisma.transactions.count({ where })
    ]);

    // Calcular totales por tipo
    const summary = await prisma.transactions.groupBy({
      by: ['type'],
      where: { user_id: userId },
      _sum: { amount: true },
      _count: true
    });

    return {
      transactions,
      summary,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  },

  // ============================================
  // BLOQUEAR USUARIO
  // ============================================
  async blockUser(
    userId: string, 
    reason: string,
    employeeId: string,
    employeeEmail: string
  ) {
    const user = await prisma.users.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new Error('Usuario no encontrado');
    }

    if (user.status === 'BLOCKED') {
      throw new Error('El usuario ya está bloqueado');
    }

    const oldStatus = user.status;

    // Bloquear usuario y cuenta
    await prisma.$transaction([
      prisma.users.update({
        where: { id: userId },
        data: { status: 'BLOCKED' }
      }),
      prisma.accounts.updateMany({
        where: { user_id: userId },
        data: { status: 'BLOCKED' }
      }),
      // Revocar todas las sesiones
      prisma.user_sessions.updateMany({
        where: { user_id: userId },
        data: { revoked_at: new Date() }
      })
    ]);

    // Crear flag de riesgo
    await prisma.risk_flags.create({
      data: {
        user_id: userId,
        type: 'manual',
        severity: 'high',
        status: 'active',
        description: `Usuario bloqueado manualmente: ${reason}`,
        action_taken: 'blocked'
      }
    });

    // Audit log
    await auditLogService.logUserAction(
      employeeId,
      employeeEmail,
      'block',
      userId,
      `Usuario bloqueado: ${reason}`,
      { status: oldStatus },
      { status: 'BLOCKED' }
    );

    return { success: true, message: 'Usuario bloqueado exitosamente' };
  },

  // ============================================
  // DESBLOQUEAR USUARIO
  // ============================================
  async unblockUser(
    userId: string,
    reason: string,
    employeeId: string,
    employeeEmail: string
  ) {
    const user = await prisma.users.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new Error('Usuario no encontrado');
    }

    if (user.status !== 'BLOCKED' && user.status !== 'SUSPENDED') {
      throw new Error('El usuario no está bloqueado');
    }

    const oldStatus = user.status;

    // Desbloquear
    await prisma.$transaction([
      prisma.users.update({
        where: { id: userId },
        data: { status: 'ACTIVE' }
      }),
      prisma.accounts.updateMany({
        where: { user_id: userId },
        data: { status: 'ACTIVE' }
      }),
      // Resolver flags activos
      prisma.risk_flags.updateMany({
        where: { 
          user_id: userId, 
          status: 'active',
          action_taken: 'blocked'
        },
        data: { 
          status: 'resolved',
          resolved_by_id: employeeId,
          resolved_at: new Date(),
          resolution_note: reason
        }
      })
    ]);

    // Audit log
    await auditLogService.logUserAction(
      employeeId,
      employeeEmail,
      'unblock',
      userId,
      `Usuario desbloqueado: ${reason}`,
      { status: oldStatus },
      { status: 'ACTIVE' }
    );

    return { success: true, message: 'Usuario desbloqueado exitosamente' };
  },

  // ============================================
  // AJUSTAR LÍMITES
  // ============================================
  async adjustLimits(
    userId: string,
    limits: {
      dailyLimit?: number;
      monthlyLimit?: number;
    },
    employeeId: string,
    employeeEmail: string,
    reason: string
  ) {
    const account = await prisma.accounts.findUnique({
      where: { user_id: userId }
    });

    if (!account) {
      throw new Error('Cuenta no encontrada');
    }

    const oldLimits = {
      daily: account.daily_limit,
      monthly: account.monthly_limit
    };

    const updated = await prisma.accounts.update({
      where: { user_id: userId },
      data: {
        daily_limit: limits.dailyLimit ? new Prisma.Decimal(limits.dailyLimit) : undefined,
        monthly_limit: limits.monthlyLimit ? new Prisma.Decimal(limits.monthlyLimit) : undefined
      }
    });

    // Audit log
    await auditLogService.logUserAction(
      employeeId,
      employeeEmail,
      'adjust_limits',
      userId,
      `Ajuste de límites: ${reason}`,
      oldLimits,
      { daily: updated.daily_limit, monthly: updated.monthly_limit }
    );

    return updated;
  },

  // ============================================
  // AGREGAR FLAG DE RIESGO
  // ============================================
  async addRiskFlag(
    userId: string,
    flag: {
      type: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      description: string;
      details?: any;
    },
    employeeId: string,
    employeeEmail: string
  ) {
    const riskFlag = await prisma.risk_flags.create({
      data: {
        user_id: userId,
        type: flag.type,
        severity: flag.severity,
        description: flag.description,
        details: flag.details
      }
    });

    // Audit log
    await auditLogService.logUserAction(
      employeeId,
      employeeEmail,
      'add_risk_flag',
      userId,
      `Flag de riesgo agregado: ${flag.type} (${flag.severity})`,
      null,
      { flagId: riskFlag.id, ...flag }
    );

    return riskFlag;
  },

  // ============================================
  // RESOLVER FLAG DE RIESGO
  // ============================================
  async resolveRiskFlag(
    flagId: string,
    resolution: string,
    employeeId: string,
    employeeEmail: string
  ) {
    const flag = await prisma.risk_flags.findUnique({
      where: { id: flagId }
    });

    if (!flag) {
      throw new Error('Flag no encontrado');
    }

    const updated = await prisma.risk_flags.update({
      where: { id: flagId },
      data: {
        status: 'resolved',
        resolved_by_id: employeeId,
        resolved_at: new Date(),
        resolution_note: resolution
      }
    });

    // Audit log
    await auditLogService.logUserAction(
      employeeId,
      employeeEmail,
      'resolve_risk_flag',
      flag.user_id,
      `Flag de riesgo resuelto: ${resolution}`,
      { status: 'active' },
      { status: 'resolved' }
    );

    return updated;
  },

  // ============================================
  // ACTUALIZAR NIVEL DE USUARIO
  // ============================================
  async updateUserLevel(
    userId: string,
    newLevel: 'PLATA' | 'ORO' | 'BLACK' | 'DIAMANTE',
    employeeId: string,
    employeeEmail: string,
    reason: string
  ) {
    const user = await prisma.users.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new Error('Usuario no encontrado');
    }

    const oldLevel = user.user_level;

    const updated = await prisma.users.update({
      where: { id: userId },
      data: { user_level: newLevel }
    });

    // Audit log
    await auditLogService.logUserAction(
      employeeId,
      employeeEmail,
      'update_level',
      userId,
      `Cambio de nivel: ${oldLevel} → ${newLevel}. Motivo: ${reason}`,
      { level: oldLevel },
      { level: newLevel }
    );

    return updated;
  },

  // ============================================
  // OBTENER AUDIT LOG DEL USUARIO
  // ============================================
  async getAuditHistory(userId: string, limit = 50) {
    return prisma.audit_logs.findMany({
      where: {
        resource: 'users',
        resource_id: userId
      },
      orderBy: { created_at: 'desc' },
      take: limit
    });
  }
};
