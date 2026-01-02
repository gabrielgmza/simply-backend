// ============================================
// OTC SERVICE - OPERACIONES OVER-THE-COUNTER
// Simply Backend v3.2.0
// ============================================

import { PrismaClient, Prisma } from '@prisma/client';
import { auditLogService } from './auditLogService';
import { treasuryService } from './treasuryService';

const prisma = new PrismaClient();

// Tipos
type OTCType = 'BUY' | 'SELL';
type OTCAsset = 'USD' | 'USDT' | 'BTC' | 'ETH';
type OTCStatus = 'PENDING' | 'APPROVED' | 'EXECUTED' | 'CANCELLED' | 'REJECTED';

interface OTCQuote {
  asset: OTCAsset;
  type: OTCType;
  amount: number;
  rate: number;
  totalARS: number;
  fee: number;
  netAmount: number;
  validUntil: Date;
}

interface OTCOperation {
  userId: string;
  type: OTCType;
  asset: OTCAsset;
  amount: number;
  rate: number;
  totalARS: number;
  fee: number;
}

// ============================================
// RATES MANAGEMENT
// ============================================

/**
 * Obtener cotización actual
 */
async function getCurrentRates(): Promise<{
  USD: { buy: number; sell: number };
  USDT: { buy: number; sell: number };
  spread: number;
}> {
  // En producción, esto se obtendría de un servicio externo o cache
  // Por ahora usamos valores de ejemplo
  const baseUSD = 1050; // Tipo de cambio base
  const spread = 0.02; // 2% spread

  return {
    USD: {
      buy: baseUSD * (1 + spread),   // Usuario compra USD = paga más ARS
      sell: baseUSD * (1 - spread),  // Usuario vende USD = recibe menos ARS
    },
    USDT: {
      buy: baseUSD * (1 + spread),
      sell: baseUSD * (1 - spread),
    },
    spread,
  };
}

/**
 * Obtener cotización para operación
 */
async function getQuote(
  asset: OTCAsset,
  type: OTCType,
  amount: number
): Promise<OTCQuote> {
  const rates = await getCurrentRates();
  const assetRates = rates[asset as keyof typeof rates];
  
  if (!assetRates || typeof assetRates === 'number') {
    throw new Error(`Asset ${asset} no soportado`);
  }

  const rate = type === 'BUY' ? assetRates.buy : assetRates.sell;
  const totalARS = amount * rate;
  
  // Fee: 0.5% para operaciones < $10k USD, 0.3% para mayores
  const feeRate = amount < 10000 ? 0.005 : 0.003;
  const fee = totalARS * feeRate;
  
  const netAmount = type === 'BUY' 
    ? totalARS + fee  // Usuario paga más
    : totalARS - fee; // Usuario recibe menos

  return {
    asset,
    type,
    amount,
    rate,
    totalARS,
    fee,
    netAmount,
    validUntil: new Date(Date.now() + 5 * 60 * 1000), // 5 minutos
  };
}

// ============================================
// OPERATION MANAGEMENT
// ============================================

/**
 * Crear operación OTC
 */
async function createOperation(
  operation: OTCOperation,
  employeeId?: string
): Promise<any> {
  // Verificar usuario
  const user = await prisma.users.findUnique({
    where: { id: operation.userId },
    include: { account: true },
  });

  if (!user) {
    throw new Error('Usuario no encontrado');
  }

  if (user.status !== 'ACTIVE') {
    throw new Error('Usuario no activo');
  }

  const account = user.account;
  if (!account) {
    throw new Error('Usuario sin cuenta');
  }

  // Validar fondos
  if (operation.type === 'BUY') {
    // Usuario compra USD/USDT, necesita ARS
    const totalNeeded = operation.totalARS + operation.fee;
    if (new Prisma.Decimal(account.balance).lessThan(totalNeeded)) {
      throw new Error('Saldo ARS insuficiente');
    }
  } else {
    // Usuario vende USD/USDT
    const balanceField = operation.asset === 'USD' ? 'balance_usd' : 'balance_usdt';
    const balance = new Prisma.Decimal(account[balanceField]);
    if (balance.lessThan(operation.amount)) {
      throw new Error(`Saldo ${operation.asset} insuficiente`);
    }
  }

  // Crear operación
  const otcOperation = await prisma.otc_operations.create({
    data: {
      user_id: operation.userId,
      type: operation.type,
      asset: operation.asset,
      amount: operation.amount,
      rate: operation.rate,
      total_ars: operation.totalARS,
      fee: operation.fee,
      status: employeeId ? 'APPROVED' : 'PENDING',
      created_by: employeeId,
    },
  });

  await auditLogService.log({
    actorType: employeeId ? 'employee' : 'user',
    actorId: employeeId || operation.userId,
    action: 'create',
    resource: 'otc_operations',
    resourceId: otcOperation.id,
    description: `Operación OTC ${operation.type} ${operation.amount} ${operation.asset}`,
    newData: operation,
  });

  return otcOperation;
}

/**
 * Aprobar operación OTC
 */
async function approveOperation(
  operationId: string,
  employeeId: string
): Promise<any> {
  const operation = await prisma.otc_operations.findUnique({
    where: { id: operationId },
  });

  if (!operation) {
    throw new Error('Operación no encontrada');
  }

  if (operation.status !== 'PENDING') {
    throw new Error(`Operación no está pendiente (estado: ${operation.status})`);
  }

  const updated = await prisma.otc_operations.update({
    where: { id: operationId },
    data: {
      status: 'APPROVED',
      approved_by: employeeId,
      approved_at: new Date(),
    },
  });

  await auditLogService.log({
    actorType: 'employee',
    actorId: employeeId,
    action: 'approve',
    resource: 'otc_operations',
    resourceId: operationId,
    description: `Operación OTC aprobada`,
    oldData: { status: 'PENDING' },
    newData: { status: 'APPROVED' },
  });

  return updated;
}

/**
 * Ejecutar operación OTC
 */
async function executeOperation(
  operationId: string,
  employeeId: string
): Promise<any> {
  const operation = await prisma.otc_operations.findUnique({
    where: { id: operationId },
    include: {
      users: {
        include: { account: true },
      },
    },
  });

  if (!operation) {
    throw new Error('Operación no encontrada');
  }

  if (operation.status !== 'APPROVED') {
    throw new Error(`Operación debe estar aprobada (estado: ${operation.status})`);
  }

  const account = operation.users?.account;
  if (!account) {
    throw new Error('Cuenta de usuario no encontrada');
  }

  // Obtener cajas OTC
  const otcAccountARS = await treasuryService.getAccountByTypeAndCurrency('otc', 'ARS');
  const otcAccountAsset = await treasuryService.getAccountByTypeAndCurrency('otc', operation.asset as any);
  const feesAccount = await treasuryService.getAccountByTypeAndCurrency('fees', 'ARS');

  if (!otcAccountARS || !otcAccountAsset || !feesAccount) {
    throw new Error('Cuentas internas OTC no configuradas');
  }

  // Ejecutar en transacción
  await prisma.$transaction(async (tx) => {
    if (operation.type === 'BUY') {
      // Usuario COMPRA USD/USDT
      // 1. Debitar ARS del usuario
      const totalDebit = new Prisma.Decimal(operation.total_ars).plus(operation.fee);
      await tx.accounts.update({
        where: { id: account.id },
        data: {
          balance: { decrement: totalDebit },
        },
      });

      // 2. Acreditar USD/USDT al usuario
      const assetField = operation.asset === 'USD' ? 'balance_usd' : 'balance_usdt';
      await tx.accounts.update({
        where: { id: account.id },
        data: {
          [assetField]: { increment: operation.amount },
        },
      });

      // 3. Registrar en caja OTC
      await treasuryService.deposit(
        otcAccountARS.id,
        parseFloat(operation.total_ars.toString()),
        `OTC BUY - Usuario ${operation.user_id}`,
        employeeId,
        operationId
      );

      // 4. Debitar de caja OTC asset
      await treasuryService.withdraw(
        otcAccountAsset.id,
        parseFloat(operation.amount.toString()),
        `OTC BUY - Usuario ${operation.user_id}`,
        employeeId,
        operationId
      );

    } else {
      // Usuario VENDE USD/USDT
      // 1. Debitar USD/USDT del usuario
      const assetField = operation.asset === 'USD' ? 'balance_usd' : 'balance_usdt';
      await tx.accounts.update({
        where: { id: account.id },
        data: {
          [assetField]: { decrement: operation.amount },
        },
      });

      // 2. Acreditar ARS al usuario (menos fee)
      const netCredit = new Prisma.Decimal(operation.total_ars).minus(operation.fee);
      await tx.accounts.update({
        where: { id: account.id },
        data: {
          balance: { increment: netCredit },
        },
      });

      // 3. Registrar en caja OTC
      await treasuryService.deposit(
        otcAccountAsset.id,
        parseFloat(operation.amount.toString()),
        `OTC SELL - Usuario ${operation.user_id}`,
        employeeId,
        operationId
      );

      await treasuryService.withdraw(
        otcAccountARS.id,
        parseFloat(operation.total_ars.toString()),
        `OTC SELL - Usuario ${operation.user_id}`,
        employeeId,
        operationId
      );
    }

    // 5. Registrar comisión
    await treasuryService.deposit(
      feesAccount.id,
      parseFloat(operation.fee.toString()),
      `Comisión OTC ${operation.type} - ${operationId}`,
      employeeId,
      operationId
    );

    // 6. Crear transacción
    await tx.transactions.create({
      data: {
        user_id: operation.user_id,
        account_id: account.id,
        type: operation.type === 'BUY' ? 'OTC_BUY' : 'OTC_SELL',
        amount: operation.total_ars,
        fee: operation.fee,
        total: new Prisma.Decimal(operation.total_ars).plus(operation.fee),
        currency: 'ARS',
        status: 'COMPLETED',
        description: `OTC ${operation.type} ${operation.amount} ${operation.asset}`,
        reference_id: operationId,
        completed_at: new Date(),
      },
    });

    // 7. Actualizar estado de operación
    await tx.otc_operations.update({
      where: { id: operationId },
      data: {
        status: 'EXECUTED',
        executed_at: new Date(),
        executed_by: employeeId,
      },
    });
  });

  await auditLogService.log({
    actorType: 'employee',
    actorId: employeeId,
    action: 'execute',
    resource: 'otc_operations',
    resourceId: operationId,
    description: `Operación OTC ejecutada`,
    newData: { status: 'EXECUTED' },
  });

  return prisma.otc_operations.findUnique({
    where: { id: operationId },
  });
}

/**
 * Rechazar operación OTC
 */
async function rejectOperation(
  operationId: string,
  employeeId: string,
  reason: string
): Promise<any> {
  const operation = await prisma.otc_operations.findUnique({
    where: { id: operationId },
  });

  if (!operation) {
    throw new Error('Operación no encontrada');
  }

  if (!['PENDING', 'APPROVED'].includes(operation.status)) {
    throw new Error(`Operación no puede ser rechazada (estado: ${operation.status})`);
  }

  const updated = await prisma.otc_operations.update({
    where: { id: operationId },
    data: {
      status: 'REJECTED',
      rejection_reason: reason,
      rejected_by: employeeId,
      rejected_at: new Date(),
    },
  });

  await auditLogService.log({
    actorType: 'employee',
    actorId: employeeId,
    action: 'reject',
    resource: 'otc_operations',
    resourceId: operationId,
    description: `Operación OTC rechazada: ${reason}`,
    newData: { status: 'REJECTED', reason },
  });

  return updated;
}

/**
 * Cancelar operación OTC
 */
async function cancelOperation(
  operationId: string,
  userId: string,
  reason: string
): Promise<any> {
  const operation = await prisma.otc_operations.findUnique({
    where: { id: operationId },
  });

  if (!operation) {
    throw new Error('Operación no encontrada');
  }

  if (operation.user_id !== userId) {
    throw new Error('No autorizado');
  }

  if (operation.status !== 'PENDING') {
    throw new Error('Solo se pueden cancelar operaciones pendientes');
  }

  const updated = await prisma.otc_operations.update({
    where: { id: operationId },
    data: {
      status: 'CANCELLED',
      cancellation_reason: reason,
      cancelled_at: new Date(),
    },
  });

  await auditLogService.log({
    actorType: 'user',
    actorId: userId,
    action: 'cancel',
    resource: 'otc_operations',
    resourceId: operationId,
    description: `Operación OTC cancelada por usuario`,
    newData: { status: 'CANCELLED', reason },
  });

  return updated;
}

// ============================================
// QUERIES
// ============================================

/**
 * Listar operaciones OTC
 */
async function listOperations(options: {
  page?: number;
  limit?: number;
  status?: OTCStatus;
  type?: OTCType;
  userId?: string;
  from?: Date;
  to?: Date;
} = {}): Promise<{ operations: any[]; total: number }> {
  const { page = 1, limit = 20, status, type, userId, from, to } = options;

  const where: any = {};
  
  if (status) where.status = status;
  if (type) where.type = type;
  if (userId) where.user_id = userId;
  if (from || to) {
    where.created_at = {};
    if (from) where.created_at.gte = from;
    if (to) where.created_at.lte = to;
  }

  const [operations, total] = await Promise.all([
    prisma.otc_operations.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        users: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
          },
        },
      },
    }),
    prisma.otc_operations.count({ where }),
  ]);

  return { operations, total };
}

/**
 * Obtener estadísticas OTC
 */
async function getStats(days: number = 30): Promise<{
  totalVolume: { ARS: number; USD: number; USDT: number };
  totalFees: number;
  operationCount: number;
  avgSize: number;
  byType: { type: string; count: number; volume: number }[];
  byStatus: { status: string; count: number }[];
}> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const operations = await prisma.otc_operations.findMany({
    where: {
      created_at: { gte: since },
      status: 'EXECUTED',
    },
  });

  let totalVolumeARS = 0;
  let totalVolumeUSD = 0;
  let totalVolumeUSDT = 0;
  let totalFees = 0;

  for (const op of operations) {
    totalVolumeARS += parseFloat(op.total_ars.toString());
    totalFees += parseFloat(op.fee.toString());
    
    if (op.asset === 'USD') {
      totalVolumeUSD += parseFloat(op.amount.toString());
    } else if (op.asset === 'USDT') {
      totalVolumeUSDT += parseFloat(op.amount.toString());
    }
  }

  // Por tipo
  const byType = await prisma.otc_operations.groupBy({
    by: ['type'],
    where: { created_at: { gte: since }, status: 'EXECUTED' },
    _count: true,
    _sum: { total_ars: true },
  });

  // Por estado
  const byStatus = await prisma.otc_operations.groupBy({
    by: ['status'],
    where: { created_at: { gte: since } },
    _count: true,
  });

  return {
    totalVolume: {
      ARS: totalVolumeARS,
      USD: totalVolumeUSD,
      USDT: totalVolumeUSDT,
    },
    totalFees,
    operationCount: operations.length,
    avgSize: operations.length > 0 ? totalVolumeARS / operations.length : 0,
    byType: byType.map(t => ({
      type: t.type,
      count: t._count,
      volume: parseFloat(t._sum.total_ars?.toString() || '0'),
    })),
    byStatus: byStatus.map(s => ({
      status: s.status,
      count: s._count,
    })),
  };
}

// ============================================
// EXPORTS
// ============================================

export const otcService = {
  // Rates
  getCurrentRates,
  getQuote,
  
  // Operations
  createOperation,
  approveOperation,
  executeOperation,
  rejectOperation,
  cancelOperation,
  
  // Queries
  listOperations,
  getStats,
};
