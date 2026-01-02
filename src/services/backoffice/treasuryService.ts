// ============================================
// TREASURY SERVICE - CAJAS INTERNAS
// Simply Backend v3.2.0
// ============================================

import { PrismaClient, Prisma } from '@prisma/client';
import { auditLogService } from './auditLogService';

const prisma = new PrismaClient();

// Tipos
type Currency = 'ARS' | 'USD' | 'USDT';
type MovementType = 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER' | 'FEE' | 'ADJUSTMENT' | 'RETURN' | 'PENALTY';

interface InternalAccount {
  id: string;
  name: string;
  currency: Currency;
  balance: Prisma.Decimal;
  type: string;
  status: string;
}

interface Movement {
  accountId: string;
  type: MovementType;
  amount: number;
  description: string;
  reference?: string;
  userId?: string;
  employeeId?: string;
}

interface TransferBetweenAccounts {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  description: string;
  employeeId: string;
}

// ============================================
// ACCOUNT MANAGEMENT
// ============================================

/**
 * Obtener todas las cuentas internas
 */
async function getAllAccounts(): Promise<InternalAccount[]> {
  const accounts = await prisma.internal_accounts.findMany({
    orderBy: [
      { type: 'asc' },
      { currency: 'asc' },
    ],
  });

  return accounts.map(a => ({
    id: a.id,
    name: a.name,
    currency: a.currency as Currency,
    balance: a.balance,
    type: a.type,
    status: a.status,
  }));
}

/**
 * Obtener cuenta por ID
 */
async function getAccountById(id: string): Promise<InternalAccount | null> {
  const account = await prisma.internal_accounts.findUnique({
    where: { id },
  });

  if (!account) return null;

  return {
    id: account.id,
    name: account.name,
    currency: account.currency as Currency,
    balance: account.balance,
    type: account.type,
    status: account.status,
  };
}

/**
 * Obtener cuenta por tipo y moneda
 */
async function getAccountByTypeAndCurrency(type: string, currency: Currency): Promise<InternalAccount | null> {
  const account = await prisma.internal_accounts.findFirst({
    where: { type, currency },
  });

  if (!account) return null;

  return {
    id: account.id,
    name: account.name,
    currency: account.currency as Currency,
    balance: account.balance,
    type: account.type,
    status: account.status,
  };
}

/**
 * Crear cuenta interna
 */
async function createAccount(
  name: string,
  type: string,
  currency: Currency,
  employeeId: string,
  initialBalance: number = 0
): Promise<InternalAccount> {
  const account = await prisma.internal_accounts.create({
    data: {
      name,
      type,
      currency,
      balance: initialBalance,
      status: 'active',
    },
  });

  await auditLogService.log({
    actorType: 'employee',
    actorId: employeeId,
    action: 'create',
    resource: 'internal_accounts',
    resourceId: account.id,
    description: `Cuenta interna creada: ${name} (${currency})`,
    newData: { name, type, currency, initialBalance },
  });

  return {
    id: account.id,
    name: account.name,
    currency: account.currency as Currency,
    balance: account.balance,
    type: account.type,
    status: account.status,
  };
}

/**
 * Inicializar cuentas por defecto
 */
async function initializeDefaultAccounts(): Promise<void> {
  const defaultAccounts = [
    { name: 'Caja Principal ARS', type: 'main', currency: 'ARS' },
    { name: 'Caja Principal USD', type: 'main', currency: 'USD' },
    { name: 'Caja Principal USDT', type: 'main', currency: 'USDT' },
    { name: 'Caja FCI ARS', type: 'fci', currency: 'ARS' },
    { name: 'Caja Comisiones ARS', type: 'fees', currency: 'ARS' },
    { name: 'Caja Comisiones USD', type: 'fees', currency: 'USD' },
    { name: 'Caja Penalizaciones ARS', type: 'penalties', currency: 'ARS' },
    { name: 'Caja OTC ARS', type: 'otc', currency: 'ARS' },
    { name: 'Caja OTC USD', type: 'otc', currency: 'USD' },
    { name: 'Caja OTC USDT', type: 'otc', currency: 'USDT' },
  ];

  for (const acc of defaultAccounts) {
    const exists = await prisma.internal_accounts.findFirst({
      where: { type: acc.type, currency: acc.currency },
    });

    if (!exists) {
      await prisma.internal_accounts.create({
        data: {
          name: acc.name,
          type: acc.type,
          currency: acc.currency,
          balance: 0,
          status: 'active',
        },
      });
      console.log(`✅ Cuenta interna creada: ${acc.name}`);
    }
  }
}

// ============================================
// MOVEMENT OPERATIONS
// ============================================

/**
 * Registrar movimiento en cuenta
 */
async function recordMovement(movement: Movement, employeeId?: string): Promise<any> {
  const account = await prisma.internal_accounts.findUnique({
    where: { id: movement.accountId },
  });

  if (!account) {
    throw new Error('Cuenta no encontrada');
  }

  const isCredit = ['DEPOSIT', 'RETURN', 'PENALTY', 'FEE'].includes(movement.type);
  const balanceBefore = account.balance;
  const balanceAfter = isCredit
    ? new Prisma.Decimal(account.balance).plus(movement.amount)
    : new Prisma.Decimal(account.balance).minus(movement.amount);

  if (!isCredit && balanceAfter.lessThan(0)) {
    throw new Error('Saldo insuficiente en la cuenta');
  }

  const [updatedAccount, movementRecord] = await prisma.$transaction([
    prisma.internal_accounts.update({
      where: { id: movement.accountId },
      data: { balance: balanceAfter },
    }),
    prisma.internal_movements.create({
      data: {
        account_id: movement.accountId,
        type: movement.type,
        amount: movement.amount,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        description: movement.description,
        reference_id: movement.reference,
        user_id: movement.userId,
        employee_id: employeeId,
      },
    }),
  ]);

  return movementRecord;
}

/**
 * Depositar en cuenta
 */
async function deposit(
  accountId: string,
  amount: number,
  description: string,
  employeeId: string,
  reference?: string
): Promise<any> {
  const movement = await recordMovement({
    accountId,
    type: 'DEPOSIT',
    amount,
    description,
    reference,
    employeeId,
  }, employeeId);

  await auditLogService.logTreasuryAction(
    employeeId,
    'deposit',
    accountId,
    { amount, description, reference },
    { movementId: movement.id }
  );

  return movement;
}

/**
 * Retirar de cuenta
 */
async function withdraw(
  accountId: string,
  amount: number,
  description: string,
  employeeId: string,
  reference?: string
): Promise<any> {
  const movement = await recordMovement({
    accountId,
    type: 'WITHDRAWAL',
    amount,
    description,
    reference,
    employeeId,
  }, employeeId);

  await auditLogService.logTreasuryAction(
    employeeId,
    'withdraw',
    accountId,
    { amount, description, reference },
    { movementId: movement.id }
  );

  return movement;
}

/**
 * Transferir entre cuentas internas
 */
async function transferBetweenAccounts(transfer: TransferBetweenAccounts): Promise<{ from: any; to: any }> {
  const fromAccount = await prisma.internal_accounts.findUnique({
    where: { id: transfer.fromAccountId },
  });

  const toAccount = await prisma.internal_accounts.findUnique({
    where: { id: transfer.toAccountId },
  });

  if (!fromAccount || !toAccount) {
    throw new Error('Una o ambas cuentas no existen');
  }

  if (new Prisma.Decimal(fromAccount.balance).lessThan(transfer.amount)) {
    throw new Error('Saldo insuficiente en cuenta origen');
  }

  // Transacción atómica
  const referenceId = `TRF-${Date.now()}`;

  const fromMovement = await recordMovement({
    accountId: transfer.fromAccountId,
    type: 'TRANSFER',
    amount: transfer.amount,
    description: `Transferencia a ${toAccount.name}: ${transfer.description}`,
    reference: referenceId,
    employeeId: transfer.employeeId,
  }, transfer.employeeId);

  const toMovement = await recordMovement({
    accountId: transfer.toAccountId,
    type: 'TRANSFER',
    amount: transfer.amount,
    description: `Transferencia desde ${fromAccount.name}: ${transfer.description}`,
    reference: referenceId,
    employeeId: transfer.employeeId,
  }, transfer.employeeId);

  await auditLogService.logTreasuryAction(
    transfer.employeeId,
    'transfer',
    transfer.fromAccountId,
    {
      fromAccountId: transfer.fromAccountId,
      toAccountId: transfer.toAccountId,
      amount: transfer.amount,
      description: transfer.description,
    },
    { referenceId }
  );

  return { from: fromMovement, to: toMovement };
}

/**
 * Ajuste de saldo (corrección manual)
 */
async function adjustBalance(
  accountId: string,
  amount: number,
  reason: string,
  employeeId: string
): Promise<any> {
  const account = await prisma.internal_accounts.findUnique({
    where: { id: accountId },
  });

  if (!account) {
    throw new Error('Cuenta no encontrada');
  }

  const balanceBefore = account.balance;
  const balanceAfter = new Prisma.Decimal(account.balance).plus(amount);

  const [updatedAccount, movement] = await prisma.$transaction([
    prisma.internal_accounts.update({
      where: { id: accountId },
      data: { balance: balanceAfter },
    }),
    prisma.internal_movements.create({
      data: {
        account_id: accountId,
        type: 'ADJUSTMENT',
        amount: Math.abs(amount),
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        description: `Ajuste manual: ${reason}`,
        employee_id: employeeId,
      },
    }),
  ]);

  await auditLogService.logTreasuryAction(
    employeeId,
    'adjustment',
    accountId,
    { amount, reason, balanceBefore: balanceBefore.toString() },
    { balanceAfter: balanceAfter.toString() }
  );

  return movement;
}

// ============================================
// QUERIES & REPORTS
// ============================================

/**
 * Obtener movimientos de una cuenta
 */
async function getAccountMovements(
  accountId: string,
  options: {
    page?: number;
    limit?: number;
    type?: MovementType;
    from?: Date;
    to?: Date;
  } = {}
): Promise<{ movements: any[]; total: number }> {
  const { page = 1, limit = 50, type, from, to } = options;

  const where: any = { account_id: accountId };
  
  if (type) where.type = type;
  if (from || to) {
    where.created_at = {};
    if (from) where.created_at.gte = from;
    if (to) where.created_at.lte = to;
  }

  const [movements, total] = await Promise.all([
    prisma.internal_movements.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.internal_movements.count({ where }),
  ]);

  return { movements, total };
}

/**
 * Obtener resumen de tesorería
 */
async function getTreasurySummary(): Promise<{
  byType: { type: string; currency: string; balance: number }[];
  byCurrency: { currency: string; total: number }[];
  totalARS: number;
  recentMovements: any[];
}> {
  const accounts = await prisma.internal_accounts.findMany({
    where: { status: 'active' },
  });

  // Agrupar por tipo
  const byType = accounts.map(a => ({
    type: a.type,
    currency: a.currency,
    balance: parseFloat(a.balance.toString()),
  }));

  // Agrupar por moneda
  const byCurrency: { currency: string; total: number }[] = [];
  const currencyTotals: Record<string, number> = {};
  
  for (const acc of accounts) {
    currencyTotals[acc.currency] = (currencyTotals[acc.currency] || 0) + parseFloat(acc.balance.toString());
  }
  
  for (const [currency, total] of Object.entries(currencyTotals)) {
    byCurrency.push({ currency, total });
  }

  // Total en ARS (para dashboard)
  const totalARS = currencyTotals['ARS'] || 0;

  // Últimos movimientos
  const recentMovements = await prisma.internal_movements.findMany({
    orderBy: { created_at: 'desc' },
    take: 10,
    include: {
      internal_accounts: {
        select: { name: true, currency: true },
      },
    },
  });

  return {
    byType,
    byCurrency,
    totalARS,
    recentMovements,
  };
}

/**
 * Obtener flujo de caja por período
 */
async function getCashFlow(
  from: Date,
  to: Date,
  currency?: Currency
): Promise<{
  deposits: number;
  withdrawals: number;
  fees: number;
  penalties: number;
  net: number;
  byDay: { date: string; in: number; out: number }[];
}> {
  const where: any = {
    created_at: { gte: from, lte: to },
  };

  if (currency) {
    const accounts = await prisma.internal_accounts.findMany({
      where: { currency },
      select: { id: true },
    });
    where.account_id = { in: accounts.map(a => a.id) };
  }

  const movements = await prisma.internal_movements.findMany({
    where,
    select: {
      type: true,
      amount: true,
      created_at: true,
    },
  });

  let deposits = 0;
  let withdrawals = 0;
  let fees = 0;
  let penalties = 0;

  const byDayMap: Record<string, { in: number; out: number }> = {};

  for (const m of movements) {
    const amount = parseFloat(m.amount.toString());
    const dateKey = m.created_at.toISOString().split('T')[0];

    if (!byDayMap[dateKey]) {
      byDayMap[dateKey] = { in: 0, out: 0 };
    }

    switch (m.type) {
      case 'DEPOSIT':
      case 'RETURN':
        deposits += amount;
        byDayMap[dateKey].in += amount;
        break;
      case 'WITHDRAWAL':
        withdrawals += amount;
        byDayMap[dateKey].out += amount;
        break;
      case 'FEE':
        fees += amount;
        byDayMap[dateKey].in += amount;
        break;
      case 'PENALTY':
        penalties += amount;
        byDayMap[dateKey].in += amount;
        break;
    }
  }

  const byDay = Object.entries(byDayMap)
    .map(([date, values]) => ({ date, ...values }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    deposits,
    withdrawals,
    fees,
    penalties,
    net: deposits + fees + penalties - withdrawals,
    byDay,
  };
}

/**
 * Conciliación de caja
 */
async function reconcileAccount(
  accountId: string,
  expectedBalance: number,
  employeeId: string
): Promise<{
  accountBalance: number;
  expectedBalance: number;
  difference: number;
  status: 'match' | 'surplus' | 'deficit';
  adjustmentMade: boolean;
}> {
  const account = await prisma.internal_accounts.findUnique({
    where: { id: accountId },
  });

  if (!account) {
    throw new Error('Cuenta no encontrada');
  }

  const accountBalance = parseFloat(account.balance.toString());
  const difference = accountBalance - expectedBalance;
  
  let status: 'match' | 'surplus' | 'deficit' = 'match';
  if (difference > 0.01) status = 'surplus';
  if (difference < -0.01) status = 'deficit';

  // Log de conciliación
  await auditLogService.log({
    actorType: 'employee',
    actorId: employeeId,
    action: 'reconcile',
    resource: 'internal_accounts',
    resourceId: accountId,
    description: `Conciliación de caja: ${status}`,
    newData: { accountBalance, expectedBalance, difference, status },
  });

  return {
    accountBalance,
    expectedBalance,
    difference,
    status,
    adjustmentMade: false,
  };
}

// ============================================
// EXPORTS
// ============================================

export const treasuryService = {
  // Accounts
  getAllAccounts,
  getAccountById,
  getAccountByTypeAndCurrency,
  createAccount,
  initializeDefaultAccounts,
  
  // Movements
  recordMovement,
  deposit,
  withdraw,
  transferBetweenAccounts,
  adjustBalance,
  
  // Queries
  getAccountMovements,
  getTreasurySummary,
  getCashFlow,
  reconcileAccount,
};
