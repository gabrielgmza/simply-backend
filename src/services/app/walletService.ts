import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// Generar CVU único de 22 dígitos
function generateCVU(): string {
  const bankCode = '0000285';  // Código de entidad (BIND)
  const branchCode = '0000';    // Sucursal
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return bankCode + branchCode + timestamp + random;
}

// Validar formato de alias
function validateAlias(alias: string): boolean {
  // palabra.palabra.palabra (solo minúsculas, puntos)
  const pattern = /^[a-z]+\.[a-z]+\.[a-z]+$/;
  return pattern.test(alias) && alias.length <= 20;
}

export const walletService = {
  // ============================================
  // OBTENER BALANCE
  // ============================================
  async getBalance(userId: string) {
    const account = await prisma.accounts.findUnique({
      where: { user_id: userId },
      select: {
        balance: true,
        balance_pending: true,
        daily_limit: true,
        monthly_limit: true,
        cvu: true,
        alias: true,
        status: true
      }
    });
    
    if (!account) {
      throw new Error('Cuenta no encontrada');
    }
    
    // Calcular disponible de inversiones
    const investments = await prisma.investments.aggregate({
      where: { 
        user_id: userId,
        status: 'ACTIVE'
      },
      _sum: {
        current_value: true
      }
    });
    
    // Calcular financiación pendiente
    const financings = await prisma.financings.aggregate({
      where: {
        user_id: userId,
        status: 'ACTIVE'
      },
      _sum: {
        remaining: true
      }
    });
    
    return {
      available: account.balance,
      pending: account.balance_pending,
      invested: investments._sum.current_value || new Prisma.Decimal(0),
      financed: financings._sum.remaining || new Prisma.Decimal(0),
      total: account.balance.add(investments._sum.current_value || 0),
      limits: {
        daily: account.daily_limit,
        monthly: account.monthly_limit
      },
      cvu: account.cvu,
      alias: account.alias,
      status: account.status
    };
  },
  
  // ============================================
  // CREAR CUENTA (tras KYC aprobado)
  // ============================================
  async createAccount(userId: string) {
    // Verificar que no tenga cuenta
    const existing = await prisma.accounts.findUnique({
      where: { user_id: userId }
    });
    
    if (existing) {
      return existing;
    }
    
    // Generar CVU único
    let cvu: string;
    let attempts = 0;
    do {
      cvu = generateCVU();
      const exists = await prisma.accounts.findUnique({ where: { cvu } });
      if (!exists) break;
      attempts++;
    } while (attempts < 10);
    
    if (attempts >= 10) {
      throw new Error('Error generando CVU');
    }
    
    // Crear cuenta
    const account = await prisma.accounts.create({
      data: {
        user_id: userId,
        cvu,
        balance: 0,
        balance_pending: 0,
        daily_limit: 500000,
        monthly_limit: 5000000,
        status: 'ACTIVE'
      }
    });
    
    return account;
  },
  
  // ============================================
  // ACTUALIZAR ALIAS
  // ============================================
  async updateAlias(userId: string, newAlias: string) {
    const account = await prisma.accounts.findUnique({
      where: { user_id: userId }
    });
    
    if (!account) {
      throw new Error('Cuenta no encontrada');
    }
    
    // Máximo 3 cambios por año
    if (account.alias_changes >= 3) {
      throw new Error('Límite de cambios de alias alcanzado (3 por año)');
    }
    
    // Validar formato
    if (!validateAlias(newAlias)) {
      throw new Error('Formato de alias inválido. Usa palabra.palabra.palabra');
    }
    
    // Verificar disponibilidad
    const existing = await prisma.accounts.findUnique({
      where: { alias: newAlias }
    });
    
    if (existing) {
      throw new Error('Este alias ya está en uso');
    }
    
    // Actualizar
    const updated = await prisma.accounts.update({
      where: { user_id: userId },
      data: {
        alias: newAlias,
        alias_changes: { increment: 1 }
      }
    });
    
    return {
      alias: updated.alias,
      changesRemaining: 3 - updated.alias_changes
    };
  },
  
  // ============================================
  // OBTENER MOVIMIENTOS
  // ============================================
  async getMovements(userId: string, options: {
    page?: number;
    limit?: number;
    type?: string;
    dateFrom?: Date;
    dateTo?: Date;
  }) {
    const { page = 1, limit = 20, type, dateFrom, dateTo } = options;
    const skip = (page - 1) * limit;
    
    const where: any = { user_id: userId };
    
    if (type) {
      where.type = type;
    }
    
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
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          type: true,
          amount: true,
          fee: true,
          total: true,
          destination_cvu: true,
          destination_alias: true,
          motive: true,
          reference: true,
          status: true,
          metadata: true,
          created_at: true,
          completed_at: true
        }
      }),
      prisma.transactions.count({ where })
    ]);
    
    return {
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  },
  
  // ============================================
  // BUSCAR POR CVU/ALIAS
  // ============================================
  async findByCVUOrAlias(identifier: string) {
    // Determinar si es CVU (22 dígitos) o alias
    const isCVU = /^\d{22}$/.test(identifier);
    
    const account = await prisma.accounts.findFirst({
      where: isCVU 
        ? { cvu: identifier }
        : { alias: identifier.toLowerCase() },
      include: {
        user: {
          select: {
            first_name: true,
            last_name: true
          }
        }
      }
    });
    
    if (!account) {
      return null;
    }
    
    return {
      cvu: account.cvu,
      alias: account.alias,
      name: `${account.user.first_name} ${account.user.last_name}`,
      status: account.status
    };
  },
  
  // ============================================
  // ACTUALIZAR BALANCE (interno)
  // ============================================
  async updateBalance(userId: string, amount: Prisma.Decimal, operation: 'add' | 'subtract') {
    const account = await prisma.accounts.findUnique({
      where: { user_id: userId }
    });
    
    if (!account) {
      throw new Error('Cuenta no encontrada');
    }
    
    if (operation === 'subtract') {
      if (account.balance.lessThan(amount)) {
        throw new Error('Saldo insuficiente');
      }
    }
    
    const updated = await prisma.accounts.update({
      where: { user_id: userId },
      data: {
        balance: operation === 'add' 
          ? { increment: amount }
          : { decrement: amount }
      }
    });
    
    return updated;
  }
};
