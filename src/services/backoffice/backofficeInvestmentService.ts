import { PrismaClient, Prisma } from '@prisma/client';
import { auditLogService } from './auditLogService';
import { systemSettingsService } from './systemSettingsService';

const prisma = new PrismaClient();

export const backofficeInvestmentService = {
  // ============================================
  // LISTAR INVERSIONES (con filtros)
  // ============================================
  async getAll(options: {
    page?: number;
    limit?: number;
    status?: string;
    userId?: string;
    minAmount?: number;
    maxAmount?: number;
    dateFrom?: Date;
    dateTo?: Date;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const { 
      page = 1, 
      limit = 20, 
      status, 
      userId,
      minAmount,
      maxAmount,
      dateFrom,
      dateTo,
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = options;
    
    const skip = (page - 1) * limit;
    const where: any = {};

    if (status) where.status = status;
    if (userId) where.user_id = userId;
    
    if (minAmount || maxAmount) {
      where.current_value = {};
      if (minAmount) where.current_value.gte = minAmount;
      if (maxAmount) where.current_value.lte = maxAmount;
    }

    if (dateFrom || dateTo) {
      where.created_at = {};
      if (dateFrom) where.created_at.gte = dateFrom;
      if (dateTo) where.created_at.lte = dateTo;
    }

    const [investments, total] = await Promise.all([
      prisma.investments.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              first_name: true,
              last_name: true,
              user_level: true
            }
          },
          _count: {
            select: { financings: true }
          }
        }
      }),
      prisma.investments.count({ where })
    ]);

    return {
      investments,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  },

  // ============================================
  // OBTENER INVERSIÓN POR ID
  // ============================================
  async getById(investmentId: string) {
    const investment = await prisma.investments.findUnique({
      where: { id: investmentId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
            dni: true,
            phone: true,
            user_level: true,
            kyc_status: true
          }
        },
        returns: {
          orderBy: { return_date: 'desc' },
          take: 30
        },
        financings: {
          include: {
            installment_records: {
              orderBy: { number: 'asc' }
            }
          }
        }
      }
    });

    if (!investment) {
      throw new Error('Inversión no encontrada');
    }

    // Calcular estadísticas
    const totalReturns = investment.returns.reduce(
      (sum, r) => sum.add(r.return_amount), 
      new Prisma.Decimal(0)
    );

    const activeFinancing = investment.financings.filter(f => f.status === 'ACTIVE');
    const totalCreditUsed = activeFinancing.reduce(
      (sum, f) => sum.add(f.remaining),
      new Prisma.Decimal(0)
    );

    return {
      ...investment,
      stats: {
        totalReturns,
        creditUsed: investment.credit_used,
        creditAvailable: investment.credit_limit.sub(investment.credit_used),
        activeFinancings: activeFinancing.length,
        totalFinancingDebt: totalCreditUsed
      }
    };
  },

  // ============================================
  // CREAR INVERSIÓN MANUAL (para usuario)
  // ============================================
  async createForUser(
    userId: string,
    amount: number,
    employeeId: string,
    employeeEmail: string,
    reason: string
  ) {
    const amountDecimal = new Prisma.Decimal(amount);

    // Verificar usuario
    const user = await prisma.users.findUnique({
      where: { id: userId },
      include: { account: true }
    });

    if (!user) {
      throw new Error('Usuario no encontrado');
    }

    if (user.kyc_status !== 'APPROVED') {
      throw new Error('Usuario no tiene KYC aprobado');
    }

    // Obtener configuración
    const financingPct = await systemSettingsService.getNumber('limits.financing_percentage');
    const creditLimit = amountDecimal.mul(financingPct).div(100);

    // Crear inversión
    const investment = await prisma.$transaction(async (tx) => {
      const inv = await tx.investments.create({
        data: {
          user_id: userId,
          amount: amountDecimal,
          current_value: amountDecimal,
          returns_earned: 0,
          fci_type: 'money_market',
          annual_rate: await systemSettingsService.getNumber('rates.fci_annual_rate'),
          credit_used: 0,
          credit_limit: creditLimit,
          status: 'ACTIVE',
          started_at: new Date()
        }
      });

      // Registrar transacción
      await tx.transactions.create({
        data: {
          user_id: userId,
          type: 'INVESTMENT_DEPOSIT',
          amount: amountDecimal,
          fee: 0,
          total: amountDecimal,
          status: 'COMPLETED',
          completed_at: new Date(),
          metadata: { 
            investment_id: inv.id,
            created_by: 'backoffice',
            employee_id: employeeId
          }
        }
      });

      return inv;
    });

    // Audit log
    await auditLogService.logInvestmentAction(
      employeeId,
      employeeEmail,
      'create',
      investment.id,
      userId,
      `Inversión creada manualmente: $${amount}`,
      { reason, amount }
    );

    return investment;
  },

  // ============================================
  // LIQUIDAR INVERSIÓN FORZADA
  // ============================================
  async forceLiquidate(
    investmentId: string,
    employeeId: string,
    employeeEmail: string,
    reason: string
  ) {
    const investment = await prisma.investments.findUnique({
      where: { id: investmentId },
      include: {
        user: true,
        financings: { where: { status: 'ACTIVE' } }
      }
    });

    if (!investment) {
      throw new Error('Inversión no encontrada');
    }

    if (investment.status !== 'ACTIVE') {
      throw new Error('La inversión ya está liquidada');
    }

    // Si tiene financiaciones activas, liquidarlas primero
    if (investment.financings.length > 0) {
      throw new Error(
        `Esta inversión tiene ${investment.financings.length} financiación(es) activa(s). ` +
        `Primero debes liquidar las financiaciones.`
      );
    }

    // Liquidar
    const result = await prisma.$transaction(async (tx) => {
      // Actualizar inversión
      const updated = await tx.investments.update({
        where: { id: investmentId },
        data: {
          status: 'LIQUIDATED',
          liquidated_at: new Date()
        }
      });

      // Acreditar al usuario
      await tx.accounts.update({
        where: { user_id: investment.user_id },
        data: {
          balance: { increment: investment.current_value }
        }
      });

      // Registrar transacción
      await tx.transactions.create({
        data: {
          user_id: investment.user_id,
          type: 'INVESTMENT_WITHDRAWAL',
          amount: investment.current_value,
          fee: 0,
          total: investment.current_value,
          status: 'COMPLETED',
          completed_at: new Date(),
          metadata: {
            investment_id: investment.id,
            liquidated_by: 'backoffice',
            employee_id: employeeId,
            reason
          }
        }
      });

      return updated;
    });

    // Audit log
    await auditLogService.logInvestmentAction(
      employeeId,
      employeeEmail,
      'force_liquidate',
      investmentId,
      investment.user_id,
      `Liquidación forzada: $${investment.current_value}`,
      { reason, amount: investment.current_value.toString() }
    );

    return {
      investment: result,
      amountCredited: investment.current_value
    };
  },

  // ============================================
  // AJUSTAR VALOR DE INVERSIÓN
  // ============================================
  async adjustValue(
    investmentId: string,
    newValue: number,
    employeeId: string,
    employeeEmail: string,
    reason: string
  ) {
    const investment = await prisma.investments.findUnique({
      where: { id: investmentId }
    });

    if (!investment) {
      throw new Error('Inversión no encontrada');
    }

    if (investment.status !== 'ACTIVE') {
      throw new Error('Solo se pueden ajustar inversiones activas');
    }

    const oldValue = investment.current_value;
    const newValueDecimal = new Prisma.Decimal(newValue);

    // Recalcular límite de crédito
    const financingPct = await systemSettingsService.getNumber('limits.financing_percentage');
    const newCreditLimit = newValueDecimal.mul(financingPct).div(100);

    // Verificar que el nuevo crédito no sea menor al usado
    if (newCreditLimit.lessThan(investment.credit_used)) {
      throw new Error(
        `El nuevo límite de crédito ($${newCreditLimit}) sería menor al crédito ya usado ($${investment.credit_used})`
      );
    }

    const updated = await prisma.investments.update({
      where: { id: investmentId },
      data: {
        current_value: newValueDecimal,
        credit_limit: newCreditLimit
      }
    });

    // Audit log
    await auditLogService.logInvestmentAction(
      employeeId,
      employeeEmail,
      'adjust_value',
      investmentId,
      investment.user_id,
      `Ajuste de valor: $${oldValue} → $${newValue}`,
      { reason, oldValue: oldValue.toString(), newValue }
    );

    return updated;
  },

  // ============================================
  // ESTADÍSTICAS GLOBALES
  // ============================================
  async getStats() {
    const [
      totalActive,
      totalLiquidated,
      sumActive,
      sumReturns,
      byUser,
      recentInvestments
    ] = await Promise.all([
      prisma.investments.count({ where: { status: 'ACTIVE' } }),
      prisma.investments.count({ where: { status: { not: 'ACTIVE' } } }),
      prisma.investments.aggregate({
        where: { status: 'ACTIVE' },
        _sum: { current_value: true, credit_used: true, credit_limit: true }
      }),
      prisma.investment_returns.aggregate({
        _sum: { return_amount: true }
      }),
      prisma.investments.groupBy({
        by: ['user_id'],
        where: { status: 'ACTIVE' },
        _sum: { current_value: true },
        _count: true
      }),
      prisma.investments.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { created_at: 'desc' },
        take: 10,
        include: {
          user: {
            select: { email: true, first_name: true, last_name: true }
          }
        }
      })
    ]);

    return {
      overview: {
        totalActive,
        totalLiquidated,
        totalInvested: sumActive._sum.current_value || 0,
        totalCreditUsed: sumActive._sum.credit_used || 0,
        totalCreditLimit: sumActive._sum.credit_limit || 0,
        totalReturnsGenerated: sumReturns._sum.return_amount || 0
      },
      distribution: {
        uniqueInvestors: byUser.length,
        avgPerUser: byUser.length > 0 
          ? (parseFloat(sumActive._sum.current_value?.toString() || '0') / byUser.length)
          : 0
      },
      recentInvestments
    };
  },

  // ============================================
  // EXPORTAR A CSV
  // ============================================
  async exportToCSV() {
    const investments = await prisma.investments.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        user: {
          select: { email: true, first_name: true, last_name: true, dni: true }
        }
      }
    });

    const headers = [
      'ID', 'Usuario', 'Email', 'DNI', 'Monto Inicial', 'Valor Actual', 
      'Rendimientos', 'Crédito Usado', 'Crédito Límite', 'Estado', 
      'Fecha Inicio', 'Fecha Liquidación'
    ];

    const rows = investments.map(inv => [
      inv.id,
      `${inv.user.first_name} ${inv.user.last_name}`,
      inv.user.email,
      inv.user.dni || '',
      inv.amount.toString(),
      inv.current_value.toString(),
      inv.returns_earned.toString(),
      inv.credit_used.toString(),
      inv.credit_limit.toString(),
      inv.status,
      inv.started_at.toISOString(),
      inv.liquidated_at?.toISOString() || ''
    ]);

    return { headers, rows };
  }
};
