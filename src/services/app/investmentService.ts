import { PrismaClient, Prisma } from '@prisma/client';
import { walletService } from './walletService';

const prisma = new PrismaClient();

// Tasa anual del FCI (22.08%)
const ANNUAL_RATE = new Prisma.Decimal(22.08);
const DAILY_RATE = ANNUAL_RATE.div(365);  // ~0.0605% diario

// Porcentaje de crédito disponible sobre inversión (15%)
const CREDIT_PERCENTAGE = new Prisma.Decimal(15);

export const investmentService = {
  // ============================================
  // OBTENER INVERSIONES DEL USUARIO
  // ============================================
  async getAll(userId: string) {
    const investments = await prisma.investments.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        amount: true,
        current_value: true,
        returns_earned: true,
        fci_type: true,
        annual_rate: true,
        credit_used: true,
        credit_limit: true,
        status: true,
        started_at: true,
        liquidated_at: true,
        created_at: true
      }
    });
    
    // Calcular totales
    const active = investments.filter(i => i.status === 'ACTIVE');
    const totalInvested = active.reduce(
      (sum, i) => sum.add(i.current_value), 
      new Prisma.Decimal(0)
    );
    const totalReturns = active.reduce(
      (sum, i) => sum.add(i.returns_earned),
      new Prisma.Decimal(0)
    );
    const totalCreditAvailable = active.reduce(
      (sum, i) => sum.add(i.credit_limit.sub(i.credit_used)),
      new Prisma.Decimal(0)
    );
    
    return {
      investments,
      summary: {
        totalInvested,
        totalReturns,
        totalCreditAvailable,
        activeCount: active.length,
        annualRate: ANNUAL_RATE
      }
    };
  },
  
  // ============================================
  // OBTENER INVERSIÓN POR ID
  // ============================================
  async getById(userId: string, investmentId: string) {
    const investment = await prisma.investments.findFirst({
      where: {
        id: investmentId,
        user_id: userId
      },
      include: {
        returns: {
          orderBy: { return_date: 'desc' },
          take: 30  // Últimos 30 días
        },
        financings: {
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            amount: true,
            remaining: true,
            installments: true,
            status: true
          }
        }
      }
    });
    
    if (!investment) {
      throw new Error('Inversión no encontrada');
    }
    
    return {
      ...investment,
      creditAvailable: investment.credit_limit.sub(investment.credit_used)
    };
  },
  
  // ============================================
  // CREAR INVERSIÓN
  // ============================================
  async create(userId: string, amount: number) {
    const amountDecimal = new Prisma.Decimal(amount);
    
    // Validaciones
    if (amountDecimal.lessThan(1000)) {
      throw new Error('Monto mínimo de inversión: $1,000');
    }
    
    // Verificar saldo disponible
    const account = await prisma.accounts.findUnique({
      where: { user_id: userId }
    });
    
    if (!account) {
      throw new Error('Cuenta no encontrada');
    }
    
    if (account.balance.lessThan(amountDecimal)) {
      throw new Error('Saldo insuficiente');
    }
    
    // Calcular límite de crédito (15% del monto)
    const creditLimit = amountDecimal.mul(CREDIT_PERCENTAGE).div(100);
    
    // Crear inversión y actualizar saldo en transacción
    const result = await prisma.$transaction(async (tx) => {
      // Descontar saldo
      await tx.accounts.update({
        where: { user_id: userId },
        data: {
          balance: { decrement: amountDecimal }
        }
      });
      
      // Crear inversión
      const investment = await tx.investments.create({
        data: {
          user_id: userId,
          amount: amountDecimal,
          current_value: amountDecimal,
          returns_earned: 0,
          fci_type: 'money_market',
          annual_rate: ANNUAL_RATE,
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
          metadata: { investment_id: investment.id }
        }
      });
      
      return investment;
    });
    
    return result;
  },
  
  // ============================================
  // LIQUIDAR INVERSIÓN
  // ============================================
  async liquidate(userId: string, investmentId: string) {
    const investment = await prisma.investments.findFirst({
      where: {
        id: investmentId,
        user_id: userId,
        status: 'ACTIVE'
      },
      include: {
        financings: {
          where: { status: 'ACTIVE' }
        }
      }
    });
    
    if (!investment) {
      throw new Error('Inversión no encontrada o ya liquidada');
    }
    
    // Verificar que no tenga financiaciones activas
    if (investment.financings.length > 0) {
      throw new Error('No puedes liquidar una inversión con financiación activa. Primero cancela las cuotas pendientes.');
    }
    
    // Liquidar y acreditar en transacción
    const result = await prisma.$transaction(async (tx) => {
      // Actualizar inversión
      const updated = await tx.investments.update({
        where: { id: investmentId },
        data: {
          status: 'LIQUIDATED',
          liquidated_at: new Date()
        }
      });
      
      // Acreditar saldo (valor actual = capital + rendimientos)
      await tx.accounts.update({
        where: { user_id: userId },
        data: {
          balance: { increment: investment.current_value }
        }
      });
      
      // Registrar transacción
      await tx.transactions.create({
        data: {
          user_id: userId,
          type: 'INVESTMENT_WITHDRAWAL',
          amount: investment.current_value,
          fee: 0,
          total: investment.current_value,
          status: 'COMPLETED',
          completed_at: new Date(),
          metadata: { 
            investment_id: investment.id,
            original_amount: investment.amount,
            returns_earned: investment.returns_earned
          }
        }
      });
      
      return updated;
    });
    
    return {
      investment: result,
      amountCredited: investment.current_value,
      returnsEarned: investment.returns_earned
    };
  },
  
  // ============================================
  // OBTENER RENDIMIENTOS
  // ============================================
  async getReturns(userId: string, investmentId: string, options: {
    page?: number;
    limit?: number;
    dateFrom?: Date;
    dateTo?: Date;
  }) {
    const { page = 1, limit = 30, dateFrom, dateTo } = options;
    const skip = (page - 1) * limit;
    
    // Verificar propiedad
    const investment = await prisma.investments.findFirst({
      where: { id: investmentId, user_id: userId }
    });
    
    if (!investment) {
      throw new Error('Inversión no encontrada');
    }
    
    const where: any = { investment_id: investmentId };
    
    if (dateFrom || dateTo) {
      where.return_date = {};
      if (dateFrom) where.return_date.gte = dateFrom;
      if (dateTo) where.return_date.lte = dateTo;
    }
    
    const [returns, total] = await Promise.all([
      prisma.investment_returns.findMany({
        where,
        skip,
        take: limit,
        orderBy: { return_date: 'desc' }
      }),
      prisma.investment_returns.count({ where })
    ]);
    
    return {
      returns,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  },
  
  // ============================================
  // SIMULAR INVERSIÓN
  // ============================================
  simulate(amount: number, months: number) {
    const amountDecimal = new Prisma.Decimal(amount);
    const dailyRate = ANNUAL_RATE.div(365).div(100);
    const days = months * 30;
    
    // Rendimiento compuesto diario
    let currentValue = amountDecimal;
    for (let i = 0; i < days; i++) {
      currentValue = currentValue.add(currentValue.mul(dailyRate));
    }
    
    const totalReturns = currentValue.sub(amountDecimal);
    const creditLimit = amountDecimal.mul(CREDIT_PERCENTAGE).div(100);
    
    return {
      initialAmount: amountDecimal,
      finalValue: currentValue.toDecimalPlaces(2),
      totalReturns: totalReturns.toDecimalPlaces(2),
      returnPercentage: totalReturns.div(amountDecimal).mul(100).toDecimalPlaces(2),
      creditAvailable: creditLimit.toDecimalPlaces(2),
      annualRate: ANNUAL_RATE,
      months,
      days
    };
  },
  
  // ============================================
  // PROCESAR RENDIMIENTOS DIARIOS (Job)
  // ============================================
  async processDailyReturns() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Solo días hábiles (Lun-Vie)
    const dayOfWeek = today.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      console.log('📅 Fin de semana - rendimientos se acumulan para día hábil');
      return { processed: 0, skipped: 'weekend' };
    }
    
    // Obtener todas las inversiones activas
    const investments = await prisma.investments.findMany({
      where: { status: 'ACTIVE' }
    });
    
    const dailyRate = ANNUAL_RATE.div(365).div(100);
    let processed = 0;
    
    for (const investment of investments) {
      // Verificar si ya se procesó hoy
      const existing = await prisma.investment_returns.findFirst({
        where: {
          investment_id: investment.id,
          return_date: today
        }
      });
      
      if (existing) continue;
      
      // Calcular rendimiento
      const returnAmount = investment.current_value.mul(dailyRate);
      
      await prisma.$transaction(async (tx) => {
        // Crear registro de rendimiento
        await tx.investment_returns.create({
          data: {
            investment_id: investment.id,
            base_amount: investment.current_value,
            rate_applied: dailyRate,
            return_amount: returnAmount,
            return_date: today,
            credited: true,
            credited_at: new Date()
          }
        });
        
        // Actualizar valor de inversión
        await tx.investments.update({
          where: { id: investment.id },
          data: {
            current_value: { increment: returnAmount },
            returns_earned: { increment: returnAmount },
            credit_limit: investment.current_value.add(returnAmount).mul(CREDIT_PERCENTAGE).div(100)
          }
        });
        
        // Registrar transacción
        await tx.transactions.create({
          data: {
            user_id: investment.user_id,
            type: 'FCI_RETURN',
            amount: returnAmount,
            fee: 0,
            total: returnAmount,
            status: 'COMPLETED',
            completed_at: new Date(),
            metadata: { investment_id: investment.id }
          }
        });
      });
      
      processed++;
    }
    
    return { processed, date: today };
  }
};
