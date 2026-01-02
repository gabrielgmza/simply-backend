import { PrismaClient, Prisma } from '@prisma/client';
import { auditLogService } from './auditLogService';
import { systemSettingsService } from './systemSettingsService';

const prisma = new PrismaClient();

export const backofficeFinancingService = {
  // ============================================
  // LISTAR FINANCIACIONES (con filtros)
  // ============================================
  async getAll(options: {
    page?: number;
    limit?: number;
    status?: string;
    userId?: string;
    investmentId?: string;
    hasOverdue?: boolean;
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
      investmentId,
      hasOverdue,
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
    if (investmentId) where.investment_id = investmentId;
    
    if (minAmount || maxAmount) {
      where.amount = {};
      if (minAmount) where.amount.gte = minAmount;
      if (maxAmount) where.amount.lte = maxAmount;
    }

    if (dateFrom || dateTo) {
      where.created_at = {};
      if (dateFrom) where.created_at.gte = dateFrom;
      if (dateTo) where.created_at.lte = dateTo;
    }

    // Filtrar por cuotas vencidas
    if (hasOverdue === true) {
      where.installment_records = {
        some: { status: 'OVERDUE' }
      };
    }

    const [financings, total] = await Promise.all([
      prisma.financings.findMany({
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
          investment: {
            select: {
              id: true,
              amount: true,
              current_value: true,
              status: true
            }
          },
          installment_records: {
            orderBy: { number: 'asc' }
          }
        }
      }),
      prisma.financings.count({ where })
    ]);

    // Agregar info de cuotas
    const enriched = financings.map(f => {
      const paid = f.installment_records.filter(i => i.status === 'PAID').length;
      const overdue = f.installment_records.filter(i => i.status === 'OVERDUE').length;
      const pending = f.installment_records.filter(i => i.status === 'PENDING').length;
      
      return {
        ...f,
        installmentsSummary: {
          total: f.installments,
          paid,
          overdue,
          pending
        }
      };
    });

    return {
      financings: enriched,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  },

  // ============================================
  // OBTENER FINANCIACIÓN POR ID
  // ============================================
  async getById(financingId: string) {
    const financing = await prisma.financings.findUnique({
      where: { id: financingId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
            dni: true,
            phone: true,
            user_level: true
          }
        },
        investment: {
          select: {
            id: true,
            amount: true,
            current_value: true,
            credit_limit: true,
            credit_used: true,
            status: true
          }
        },
        installment_records: {
          orderBy: { number: 'asc' }
        }
      }
    });

    if (!financing) {
      throw new Error('Financiación no encontrada');
    }

    // Calcular estadísticas
    const paid = financing.installment_records.filter(i => i.status === 'PAID');
    const overdue = financing.installment_records.filter(i => i.status === 'OVERDUE');
    const pending = financing.installment_records.filter(i => i.status === 'PENDING');

    const totalPaid = paid.reduce((sum, i) => sum.add(i.amount), new Prisma.Decimal(0));
    const totalOverdue = overdue.reduce((sum, i) => sum.add(i.total_due), new Prisma.Decimal(0));
    const totalPenalties = financing.installment_records.reduce(
      (sum, i) => sum.add(i.penalty_amount), 
      new Prisma.Decimal(0)
    );

    return {
      ...financing,
      stats: {
        installmentsPaid: paid.length,
        installmentsOverdue: overdue.length,
        installmentsPending: pending.length,
        totalPaid,
        totalOverdue,
        totalPenalties,
        nextDueDate: pending[0]?.due_date || null
      }
    };
  },

  // ============================================
  // CANCELAR CUOTA MANUAL
  // ============================================
  async payInstallmentManual(
    installmentId: string,
    employeeId: string,
    employeeEmail: string,
    reason: string
  ) {
    const installment = await prisma.installments.findUnique({
      where: { id: installmentId },
      include: {
        financing: {
          include: { user: true, investment: true }
        }
      }
    });

    if (!installment) {
      throw new Error('Cuota no encontrada');
    }

    if (installment.status === 'PAID') {
      throw new Error('Esta cuota ya está pagada');
    }

    // Pagar cuota
    const result = await prisma.$transaction(async (tx) => {
      // Actualizar cuota
      const paidInstallment = await tx.installments.update({
        where: { id: installmentId },
        data: {
          status: 'PAID',
          paid_at: new Date()
        }
      });

      // Actualizar financiación
      const newRemaining = installment.financing.remaining.sub(installment.amount);
      const isCompleted = newRemaining.lessThanOrEqualTo(0);

      // Buscar próxima cuota pendiente
      const nextPending = await tx.installments.findFirst({
        where: {
          financing_id: installment.financing_id,
          status: 'PENDING',
          id: { not: installmentId }
        },
        orderBy: { number: 'asc' }
      });

      await tx.financings.update({
        where: { id: installment.financing_id },
        data: {
          remaining: newRemaining.lessThan(0) ? 0 : newRemaining,
          status: isCompleted ? 'COMPLETED' : 'ACTIVE',
          next_due_date: nextPending?.due_date || null,
          completed_at: isCompleted ? new Date() : null
        }
      });

      // Si se completó, liberar crédito
      if (isCompleted) {
        await tx.investments.update({
          where: { id: installment.financing.investment_id },
          data: {
            credit_used: { decrement: installment.financing.amount }
          }
        });
      }

      // Registrar transacción
      await tx.transactions.create({
        data: {
          user_id: installment.financing.user_id,
          type: 'INSTALLMENT_PAYMENT',
          amount: installment.total_due,
          fee: 0,
          total: installment.total_due,
          status: 'COMPLETED',
          completed_at: new Date(),
          metadata: {
            financing_id: installment.financing_id,
            installment_number: installment.number,
            paid_by: 'backoffice',
            employee_id: employeeId,
            reason
          }
        }
      });

      return paidInstallment;
    });

    // Audit log
    await auditLogService.logFinancingAction(
      employeeId,
      employeeEmail,
      'manual_payment',
      installment.financing_id,
      installment.financing.user_id,
      `Pago manual de cuota ${installment.number}: $${installment.total_due}`,
      { reason, installmentId, amount: installment.total_due.toString() }
    );

    return result;
  },

  // ============================================
  // LIQUIDAR FINANCIACIÓN FORZADA
  // ============================================
  async forceLiquidate(
    financingId: string,
    employeeId: string,
    employeeEmail: string,
    reason: string
  ) {
    const financing = await prisma.financings.findUnique({
      where: { id: financingId },
      include: {
        investment: true,
        user: true,
        installment_records: { where: { status: { not: 'PAID' } } }
      }
    });

    if (!financing) {
      throw new Error('Financiación no encontrada');
    }

    if (financing.status !== 'ACTIVE') {
      throw new Error('Solo se pueden liquidar financiaciones activas');
    }

    // Calcular penalización
    const penaltyRate = await systemSettingsService.getNumber('rates.penalty_rate');
    const penalty = financing.remaining.mul(penaltyRate).div(100);
    const totalToPay = financing.remaining.add(penalty);

    // Verificar que la inversión cubra el total
    if (financing.investment.current_value.lessThan(totalToPay)) {
      throw new Error(
        `La inversión ($${financing.investment.current_value}) no cubre la deuda + penalización ($${totalToPay})`
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      // Marcar cuotas como dropped
      await tx.installments.updateMany({
        where: {
          financing_id: financingId,
          status: { not: 'PAID' }
        },
        data: { status: 'DROPPED' }
      });

      // Actualizar financiación
      await tx.financings.update({
        where: { id: financingId },
        data: {
          status: 'LIQUIDATED',
          penalty_applied: true,
          penalty_amount: penalty,
          remaining: 0,
          completed_at: new Date()
        }
      });

      // Liquidar inversión
      const remainingAfterDebt = financing.investment.current_value.sub(totalToPay);

      await tx.investments.update({
        where: { id: financing.investment_id },
        data: {
          status: 'LIQUIDATED_BY_PENALTY',
          current_value: 0,
          credit_used: 0,
          liquidated_at: new Date()
        }
      });

      // Si sobra, acreditar al usuario
      if (remainingAfterDebt.greaterThan(0)) {
        await tx.accounts.update({
          where: { user_id: financing.user_id },
          data: {
            balance: { increment: remainingAfterDebt }
          }
        });
      }

      // Registrar transacción de penalización
      await tx.transactions.create({
        data: {
          user_id: financing.user_id,
          type: 'PENALTY_CHARGE',
          amount: penalty,
          fee: 0,
          total: penalty,
          status: 'COMPLETED',
          completed_at: new Date(),
          metadata: {
            financing_id: financingId,
            liquidated_by: 'backoffice',
            employee_id: employeeId,
            reason
          }
        }
      });

      return {
        debtPaid: financing.remaining,
        penaltyCharged: penalty,
        totalDeducted: totalToPay,
        returnedToUser: remainingAfterDebt.greaterThan(0) ? remainingAfterDebt : new Prisma.Decimal(0)
      };
    });

    // Audit log
    await auditLogService.logFinancingAction(
      employeeId,
      employeeEmail,
      'force_liquidate',
      financingId,
      financing.user_id,
      `Liquidación forzada: Deuda $${financing.remaining} + Penalización $${penalty}`,
      { reason, ...result }
    );

    return result;
  },

  // ============================================
  // CONDONAR CUOTA (Quitar penalización)
  // ============================================
  async waivePenalty(
    installmentId: string,
    employeeId: string,
    employeeEmail: string,
    reason: string
  ) {
    const installment = await prisma.installments.findUnique({
      where: { id: installmentId },
      include: { financing: true }
    });

    if (!installment) {
      throw new Error('Cuota no encontrada');
    }

    if (installment.penalty_amount.equals(0)) {
      throw new Error('Esta cuota no tiene penalización');
    }

    const oldPenalty = installment.penalty_amount;

    const updated = await prisma.installments.update({
      where: { id: installmentId },
      data: {
        penalty_amount: 0,
        total_due: installment.amount
      }
    });

    // Audit log
    await auditLogService.logFinancingAction(
      employeeId,
      employeeEmail,
      'waive_penalty',
      installment.financing_id,
      installment.financing.user_id,
      `Condonación de penalización cuota ${installment.number}: $${oldPenalty}`,
      { reason, oldPenalty: oldPenalty.toString() }
    );

    return updated;
  },

  // ============================================
  // EXTENDER PLAZO DE CUOTA
  // ============================================
  async extendDueDate(
    installmentId: string,
    newDueDate: Date,
    employeeId: string,
    employeeEmail: string,
    reason: string
  ) {
    const installment = await prisma.installments.findUnique({
      where: { id: installmentId },
      include: { financing: true }
    });

    if (!installment) {
      throw new Error('Cuota no encontrada');
    }

    if (installment.status === 'PAID') {
      throw new Error('No se puede extender una cuota ya pagada');
    }

    const oldDueDate = installment.due_date;

    // Resetear a PENDING si estaba OVERDUE
    const updated = await prisma.installments.update({
      where: { id: installmentId },
      data: {
        due_date: newDueDate,
        status: 'PENDING'
      }
    });

    // Actualizar next_due_date en financiación si corresponde
    await prisma.financings.update({
      where: { id: installment.financing_id },
      data: { next_due_date: newDueDate }
    });

    // Audit log
    await auditLogService.logFinancingAction(
      employeeId,
      employeeEmail,
      'extend_due_date',
      installment.financing_id,
      installment.financing.user_id,
      `Extensión de vencimiento cuota ${installment.number}: ${oldDueDate.toISOString()} → ${newDueDate.toISOString()}`,
      { reason, oldDueDate: oldDueDate.toISOString(), newDueDate: newDueDate.toISOString() }
    );

    return updated;
  },

  // ============================================
  // ESTADÍSTICAS GLOBALES
  // ============================================
  async getStats() {
    const [
      totalActive,
      totalCompleted,
      totalDefaulted,
      sumActive,
      overdueInstallments,
      recentFinancings
    ] = await Promise.all([
      prisma.financings.count({ where: { status: 'ACTIVE' } }),
      prisma.financings.count({ where: { status: 'COMPLETED' } }),
      prisma.financings.count({ where: { status: { in: ['DEFAULTED', 'LIQUIDATED'] } } }),
      prisma.financings.aggregate({
        where: { status: 'ACTIVE' },
        _sum: { remaining: true, amount: true, penalty_amount: true }
      }),
      prisma.installments.count({ where: { status: 'OVERDUE' } }),
      prisma.financings.findMany({
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

    // NPL (Non-Performing Loans)
    const totalFinanced = sumActive._sum.amount || new Prisma.Decimal(0);
    const totalOverdue = await prisma.installments.aggregate({
      where: { status: 'OVERDUE' },
      _sum: { total_due: true }
    });

    const nplRatio = totalFinanced.greaterThan(0)
      ? parseFloat(totalOverdue._sum.total_due?.toString() || '0') / parseFloat(totalFinanced.toString()) * 100
      : 0;

    return {
      overview: {
        totalActive,
        totalCompleted,
        totalDefaulted,
        totalFinanced: sumActive._sum.amount || 0,
        totalDebt: sumActive._sum.remaining || 0,
        totalPenalties: sumActive._sum.penalty_amount || 0
      },
      risk: {
        overdueInstallments,
        overdueAmount: totalOverdue._sum.total_due || 0,
        nplRatio: nplRatio.toFixed(2)
      },
      recentFinancings
    };
  },

  // ============================================
  // OBTENER CUOTAS POR VENCER
  // ============================================
  async getUpcomingDue(days = 7) {
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() + days);

    return prisma.installments.findMany({
      where: {
        status: 'PENDING',
        due_date: { lte: dateLimit }
      },
      orderBy: { due_date: 'asc' },
      include: {
        financing: {
          include: {
            user: {
              select: { email: true, first_name: true, last_name: true, phone: true }
            }
          }
        }
      }
    });
  },

  // ============================================
  // EXPORTAR A CSV
  // ============================================
  async exportToCSV() {
    const financings = await prisma.financings.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        user: {
          select: { email: true, first_name: true, last_name: true, dni: true }
        },
        _count: {
          select: { installment_records: true }
        }
      }
    });

    const headers = [
      'ID', 'Usuario', 'Email', 'DNI', 'Monto', 'Cuotas', 'Valor Cuota',
      'Restante', 'Penalización', 'Estado', 'Fecha Inicio', 'Próximo Vencimiento'
    ];

    const rows = financings.map(f => [
      f.id,
      `${f.user.first_name} ${f.user.last_name}`,
      f.user.email,
      f.user.dni || '',
      f.amount.toString(),
      f.installments.toString(),
      f.installment_amount.toString(),
      f.remaining.toString(),
      f.penalty_amount?.toString() || '0',
      f.status,
      f.started_at.toISOString(),
      f.next_due_date?.toISOString() || ''
    ]);

    return { headers, rows };
  }
};
