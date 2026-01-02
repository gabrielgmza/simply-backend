import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// Penalización por mora: 3% sobre saldo pendiente
const PENALTY_RATE = new Prisma.Decimal(3);

export const financingService = {
  // ============================================
  // OBTENER FINANCIACIONES DEL USUARIO
  // ============================================
  async getAll(userId: string) {
    const financings = await prisma.financings.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      include: {
        investment: {
          select: {
            id: true,
            amount: true,
            current_value: true
          }
        },
        installment_records: {
          orderBy: { number: 'asc' },
          select: {
            id: true,
            number: true,
            amount: true,
            penalty_amount: true,
            total_due: true,
            status: true,
            due_date: true,
            paid_at: true
          }
        }
      }
    });
    
    // Calcular totales
    const active = financings.filter(f => f.status === 'ACTIVE');
    const totalDebt = active.reduce(
      (sum, f) => sum.add(f.remaining),
      new Prisma.Decimal(0)
    );
    
    return {
      financings,
      summary: {
        totalDebt,
        activeCount: active.length,
        completedCount: financings.filter(f => f.status === 'COMPLETED').length
      }
    };
  },
  
  // ============================================
  // OBTENER FINANCIACIÓN POR ID
  // ============================================
  async getById(userId: string, financingId: string) {
    const financing = await prisma.financings.findFirst({
      where: {
        id: financingId,
        user_id: userId
      },
      include: {
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
    });
    
    if (!financing) {
      throw new Error('Financiación no encontrada');
    }
    
    // Calcular próxima cuota
    const nextInstallment = financing.installment_records.find(
      i => i.status === 'PENDING' || i.status === 'OVERDUE'
    );
    
    return {
      ...financing,
      nextInstallment
    };
  },
  
  // ============================================
  // CREAR FINANCIACIÓN
  // ============================================
  async create(userId: string, data: {
    investmentId: string;
    amount: number;
    installments: number;
    destinationType?: string;
    destinationRef?: string;
    description?: string;
  }) {
    const { investmentId, amount, installments, destinationType, destinationRef, description } = data;
    const amountDecimal = new Prisma.Decimal(amount);
    
    // Validaciones
    if (installments < 2 || installments > 48) {
      throw new Error('Número de cuotas debe ser entre 2 y 48');
    }
    
    if (amountDecimal.lessThan(1000)) {
      throw new Error('Monto mínimo de financiación: $1,000');
    }
    
    // Verificar inversión y crédito disponible
    const investment = await prisma.investments.findFirst({
      where: {
        id: investmentId,
        user_id: userId,
        status: 'ACTIVE'
      }
    });
    
    if (!investment) {
      throw new Error('Inversión no encontrada o inactiva');
    }
    
    const creditAvailable = investment.credit_limit.sub(investment.credit_used);
    
    if (amountDecimal.greaterThan(creditAvailable)) {
      throw new Error(`Crédito disponible insuficiente. Disponible: $${creditAvailable.toFixed(2)}`);
    }
    
    // Calcular cuota (0% interés)
    const installmentAmount = amountDecimal.div(installments).toDecimalPlaces(2);
    
    // Calcular primera fecha de vencimiento (próximo mes)
    const firstDueDate = new Date();
    firstDueDate.setMonth(firstDueDate.getMonth() + 1);
    firstDueDate.setDate(10);  // Día 10 de cada mes
    
    // Crear financiación y cuotas en transacción
    const result = await prisma.$transaction(async (tx) => {
      // Actualizar crédito usado en inversión
      await tx.investments.update({
        where: { id: investmentId },
        data: {
          credit_used: { increment: amountDecimal }
        }
      });
      
      // Crear financiación
      const financing = await tx.financings.create({
        data: {
          user_id: userId,
          investment_id: investmentId,
          amount: amountDecimal,
          total_amount: amountDecimal,
          remaining: amountDecimal,
          installments,
          installment_amount: installmentAmount,
          interest_rate: 0,
          destination_type: destinationType,
          destination_ref: destinationRef,
          description,
          status: 'ACTIVE',
          next_due_date: firstDueDate
        }
      });
      
      // Crear cuotas
      const installmentRecords = [];
      for (let i = 1; i <= installments; i++) {
        const dueDate = new Date(firstDueDate);
        dueDate.setMonth(dueDate.getMonth() + (i - 1));
        
        const record = await tx.installments.create({
          data: {
            financing_id: financing.id,
            number: i,
            amount: installmentAmount,
            penalty_amount: 0,
            total_due: installmentAmount,
            status: 'PENDING',
            due_date: dueDate
          }
        });
        installmentRecords.push(record);
      }
      
      // Acreditar monto al saldo disponible
      await tx.accounts.update({
        where: { user_id: userId },
        data: {
          balance: { increment: amountDecimal }
        }
      });
      
      // Registrar transacción
      await tx.transactions.create({
        data: {
          user_id: userId,
          type: 'INVESTMENT_DEPOSIT',  // El dinero entra a la cuenta
          amount: amountDecimal,
          fee: 0,
          total: amountDecimal,
          status: 'COMPLETED',
          completed_at: new Date(),
          reference: description,
          metadata: {
            financing_id: financing.id,
            investment_id: investmentId,
            type: 'financing_disbursement'
          }
        }
      });
      
      return { financing, installmentRecords };
    });
    
    return result;
  },
  
  // ============================================
  // SIMULAR FINANCIACIÓN
  // ============================================
  simulate(amount: number, installments: number) {
    const amountDecimal = new Prisma.Decimal(amount);
    
    if (installments < 2 || installments > 48) {
      throw new Error('Número de cuotas debe ser entre 2 y 48');
    }
    
    const installmentAmount = amountDecimal.div(installments).toDecimalPlaces(2);
    const totalAmount = installmentAmount.mul(installments);
    
    // Generar cronograma
    const schedule = [];
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() + 1);
    startDate.setDate(10);
    
    for (let i = 1; i <= installments; i++) {
      const dueDate = new Date(startDate);
      dueDate.setMonth(dueDate.getMonth() + (i - 1));
      
      schedule.push({
        number: i,
        amount: installmentAmount,
        dueDate
      });
    }
    
    return {
      amount: amountDecimal,
      installments,
      installmentAmount,
      totalAmount,
      interestRate: 0,
      schedule
    };
  },
  
  // ============================================
  // PAGAR CUOTA
  // ============================================
  async payInstallment(userId: string, installmentId: string) {
    const installment = await prisma.installments.findFirst({
      where: { id: installmentId },
      include: {
        financing: {
          include: {
            user: true
          }
        }
      }
    });
    
    if (!installment) {
      throw new Error('Cuota no encontrada');
    }
    
    if (installment.financing.user_id !== userId) {
      throw new Error('No autorizado');
    }
    
    if (installment.status === 'PAID') {
      throw new Error('Esta cuota ya está pagada');
    }
    
    // Verificar saldo
    const account = await prisma.accounts.findUnique({
      where: { user_id: userId }
    });
    
    if (!account || account.balance.lessThan(installment.total_due)) {
      throw new Error('Saldo insuficiente');
    }
    
    // Procesar pago
    const result = await prisma.$transaction(async (tx) => {
      // Actualizar cuota
      const paidInstallment = await tx.installments.update({
        where: { id: installmentId },
        data: {
          status: 'PAID',
          paid_at: new Date()
        }
      });
      
      // Descontar saldo
      await tx.accounts.update({
        where: { user_id: userId },
        data: {
          balance: { decrement: installment.total_due }
        }
      });
      
      // Actualizar financiación
      const newRemaining = installment.financing.remaining.sub(installment.amount);
      const isCompleted = newRemaining.lessThanOrEqualTo(0);
      
      // Calcular próxima cuota pendiente
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
          next_due_date: nextPending?.due_date ?? undefined,
          completed_at: isCompleted ? new Date() : undefined
        }
      });
      
      // Si se completó, liberar crédito en inversión
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
          user_id: userId,
          type: 'INSTALLMENT_PAYMENT',
          amount: installment.total_due,
          fee: 0,
          total: installment.total_due,
          status: 'COMPLETED',
          completed_at: new Date(),
          metadata: {
            financing_id: installment.financing_id,
            installment_number: installment.number,
            penalty_included: installment.penalty_amount.greaterThan(0)
          }
        }
      });
      
      return paidInstallment;
    });
    
    return result;
  },
  
  // ============================================
  // CAÍDA DE CUOTAS (Drop)
  // ============================================
  async dropFinancing(userId: string, financingId: string) {
    const financing = await prisma.financings.findFirst({
      where: {
        id: financingId,
        user_id: userId,
        status: 'ACTIVE'
      },
      include: {
        investment: true,
        installment_records: {
          where: { status: { not: 'PAID' } }
        }
      }
    });
    
    if (!financing) {
      throw new Error('Financiación no encontrada o ya completada');
    }
    
    // Calcular penalización (3% del saldo pendiente)
    const penalty = financing.remaining.mul(PENALTY_RATE).div(100);
    const totalToPay = financing.remaining.add(penalty);
    
    // Verificar si la inversión cubre el total
    if (financing.investment.current_value.lessThan(totalToPay)) {
      throw new Error('El valor de la inversión no cubre el saldo + penalización');
    }
    
    // Procesar caída
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
      
      // Liquidar inversión para cubrir deuda
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
      
      // Si sobra algo, acreditar al usuario
      if (remainingAfterDebt.greaterThan(0)) {
        await tx.accounts.update({
          where: { user_id: userId },
          data: {
            balance: { increment: remainingAfterDebt }
          }
        });
      }
      
      // Registrar transacción de penalización
      await tx.transactions.create({
        data: {
          user_id: userId,
          type: 'PENALTY_CHARGE',
          amount: penalty,
          fee: 0,
          total: penalty,
          status: 'COMPLETED',
          completed_at: new Date(),
          metadata: {
            financing_id: financingId,
            reason: 'early_termination'
          }
        }
      });
      
      return {
        debtPaid: financing.remaining,
        penaltyCharged: penalty,
        totalDeducted: totalToPay,
        returnedToUser: remainingAfterDebt.greaterThan(0) ? remainingAfterDebt : 0
      };
    });
    
    return result;
  },
  
  // ============================================
  // PROCESAR CUOTAS VENCIDAS (Job diario)
  // ============================================
  async processOverdueInstallments() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Buscar cuotas vencidas no marcadas
    const overdue = await prisma.installments.findMany({
      where: {
        status: 'PENDING',
        due_date: { lt: today }
      },
      include: {
        financing: true
      }
    });
    
    let processed = 0;
    
    for (const installment of overdue) {
      // Calcular días de mora
      const daysOverdue = Math.floor(
        (today.getTime() - installment.due_date.getTime()) / (1000 * 60 * 60 * 24)
      );
      
      // Aplicar penalización si es primera vez
      if (installment.penalty_amount.equals(0) && daysOverdue >= 1) {
        const penalty = installment.amount.mul(PENALTY_RATE).div(100);
        
        await prisma.installments.update({
          where: { id: installment.id },
          data: {
            status: 'OVERDUE',
            penalty_amount: penalty,
            total_due: installment.amount.add(penalty)
          }
        });
        
        // TODO: Notificar al usuario
        processed++;
      }
    }
    
    return { processed, date: today };
  }
};
