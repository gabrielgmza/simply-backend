import { PrismaClient, Prisma, TransactionStatus } from '@prisma/client';
import { auditLogService } from './backoffice/auditLogService';
import { fraudDetectionService } from './backoffice/fraudDetectionService';

const prisma = new PrismaClient();

// Motivos de transferencia BCRA (Comunicación "A" 3885)
export const MOTIVOS_BCRA = {
  ALQ: 'Alquileres',
  CUO: 'Cuota',
  EXP: 'Expensas',
  FAC: 'Factura',
  PRE: 'Préstamo',
  SEG: 'Seguro',
  HON: 'Honorarios',
  SUE: 'Sueldo',
  VAR: 'Varios',
  HAB: 'Haberes jubilatorios',
  SER: 'Prestación de servicios',
  BIE: 'Compra de bienes',
  INM: 'Operaciones inmobiliarias',
  PRO: 'Pago a proveedores'
} as const;

interface TransferRequest {
  userId: string;
  destinationCvu: string;
  amount: number;
  motive: keyof typeof MOTIVOS_BCRA;
  reference?: string;
  paymentMethod: 'account' | 'financing';
  installments?: number; // 2-48 si es financing
}

interface ValidateCvuResult {
  valid: boolean;
  cvu: string;
  holderName?: string;
  bank?: string;
  accountType?: string;
  error?: string;
}

export const transferService = {
  // ==========================================
  // VALIDAR CVU/CBU/ALIAS
  // ==========================================

  async validateDestination(destination: string): Promise<ValidateCvuResult> {
    const cleaned = destination.replace(/[\s.-]/g, '');

    // Detectar tipo
    let cvu: string;
    let isAlias = false;

    if (/^\d{22}$/.test(cleaned)) {
      // Es CVU o CBU
      cvu = cleaned;
    } else if (/^[a-zA-Z0-9.]+$/.test(destination) && destination.length <= 20) {
      // Es Alias
      isAlias = true;
      // Buscar en nuestra base primero
      const account = await prisma.accounts.findFirst({
        where: { alias: destination.toLowerCase() },
        include: { user: { select: { first_name: true, last_name: true } } }
      });

      if (account) {
        return {
          valid: true,
          cvu: account.cvu,
          holderName: `${account.user.first_name} ${account.user.last_name}`,
          bank: 'Simply by PaySur',
          accountType: 'CVU'
        };
      }

      // TODO: Consultar BIND API para alias externos
      // Por ahora simular
      return {
        valid: false,
        cvu: '',
        error: 'Alias no encontrado'
      };
    } else {
      return {
        valid: false,
        cvu: '',
        error: 'Formato inválido. Ingrese CVU (22 dígitos) o Alias'
      };
    }

    // Validar checksum CVU/CBU
    if (!this.validateCvuChecksum(cvu)) {
      return {
        valid: false,
        cvu,
        error: 'CVU/CBU inválido (checksum incorrecto)'
      };
    }

    // Buscar en nuestra base
    const internalAccount = await prisma.accounts.findUnique({
      where: { cvu },
      include: { user: { select: { first_name: true, last_name: true } } }
    });

    if (internalAccount) {
      return {
        valid: true,
        cvu,
        holderName: `${internalAccount.user.first_name} ${internalAccount.user.last_name}`,
        bank: 'Simply by PaySur',
        accountType: 'CVU'
      };
    }

    // TODO: Consultar BIND API para CVU/CBU externos
    // Por ahora simular banco externo
    const bankCode = cvu.substring(0, 3);
    const bankNames: Record<string, string> = {
      '000': 'Banco de la Nación Argentina',
      '007': 'Banco de Galicia',
      '011': 'Banco de la Provincia de Buenos Aires',
      '014': 'Banco de la Ciudad de Buenos Aires',
      '015': 'Banco Industrial',
      '017': 'BBVA Argentina',
      '027': 'Banco Supervielle',
      '029': 'Banco de la Pampa',
      '034': 'Banco Patagonia',
      '044': 'Banco Hipotecario',
      '072': 'Banco Santander',
      '083': 'Banco del Chubut',
      '094': 'Banco de Corrientes',
      '150': 'HSBC Bank Argentina',
      '191': 'Banco Credicoop',
      '285': 'Banco Macro',
      '299': 'Banco Comafi',
      '303': 'Banco Finansur',
      '322': 'Banco CMF',
      '330': 'Nuevo Banco de Santa Fe',
      '386': 'Banco de Entre Ríos'
    };

    return {
      valid: true,
      cvu,
      holderName: 'Titular Externo', // BIND devolvería el nombre real
      bank: bankNames[bankCode] || 'Banco Externo',
      accountType: cvu.startsWith('000007') ? 'CVU' : 'CBU'
    };
  },

  validateCvuChecksum(cvu: string): boolean {
    if (cvu.length !== 22) return false;

    // Validar primer bloque (banco + sucursal) - 8 dígitos
    const block1 = cvu.substring(0, 7);
    const check1 = parseInt(cvu[7]);
    const weights1 = [7, 1, 3, 9, 7, 1, 3];
    let sum1 = 0;
    for (let i = 0; i < 7; i++) {
      sum1 += parseInt(block1[i]) * weights1[i];
    }
    const expected1 = (10 - (sum1 % 10)) % 10;
    if (check1 !== expected1) return false;

    // Validar segundo bloque (cuenta) - 14 dígitos
    const block2 = cvu.substring(8, 21);
    const check2 = parseInt(cvu[21]);
    const weights2 = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3];
    let sum2 = 0;
    for (let i = 0; i < 13; i++) {
      sum2 += parseInt(block2[i]) * weights2[i];
    }
    const expected2 = (10 - (sum2 % 10)) % 10;
    if (check2 !== expected2) return false;

    return true;
  },

  // ==========================================
  // REALIZAR TRANSFERENCIA
  // ==========================================

  async transfer(req: TransferRequest) {
    const { userId, destinationCvu, amount, motive, reference, paymentMethod, installments } = req;

    // Validar usuario y cuenta origen
    const user = await prisma.users.findUnique({
      where: { id: userId },
      include: { account: true }
    });

    if (!user || !user.account) {
      throw new Error('Usuario o cuenta no encontrada');
    }

    if (user.status !== 'ACTIVE') {
      throw new Error('Usuario bloqueado o inactivo');
    }

    // Validar destino
    const destination = await this.validateDestination(destinationCvu);
    if (!destination.valid) {
      throw new Error(destination.error || 'Destino inválido');
    }

    // No transferir a sí mismo
    if (destination.cvu === user.account.cvu) {
      throw new Error('No puedes transferir a tu propia cuenta');
    }

    // Validar monto
    if (amount <= 0) {
      throw new Error('Monto debe ser mayor a 0');
    }

    if (amount < 100) {
      throw new Error('Monto mínimo: $100');
    }

    // Verificar límites
    const dailyUsed = await this.getDailyTransferTotal(userId);
    const monthlyUsed = await this.getMonthlyTransferTotal(userId);

    if (dailyUsed + amount > Number(user.account.daily_limit)) {
      throw new Error(`Excede límite diario. Disponible: $${Number(user.account.daily_limit) - dailyUsed}`);
    }

    if (monthlyUsed + amount > Number(user.account.monthly_limit)) {
      throw new Error(`Excede límite mensual. Disponible: $${Number(user.account.monthly_limit) - monthlyUsed}`);
    }

    // Fraud check
    const fraudCheck = await fraudDetectionService.evaluateTransaction({
      userId,
      type: 'TRANSFER_OUT',
      amount,
      destinationCvu: destination.cvu
    });

    if (fraudCheck.action === 'block') {
      throw new Error('Operación bloqueada por seguridad. Contacte soporte.');
    }

    // Determinar fuente de fondos
    let sourceType: 'ACCOUNT' | 'FINANCING';
    let financingId: string | null = null;

    if (paymentMethod === 'account') {
      // Verificar saldo
      if (Number(user.account.balance) < amount) {
        throw new Error(`Saldo insuficiente. Disponible: $${user.account.balance}`);
      }
      sourceType = 'ACCOUNT';
    } else {
      // Financiación
      if (!installments || installments < 2 || installments > 48) {
        throw new Error('Cuotas debe ser entre 2 y 48');
      }

      // Verificar límite de financiación disponible
      const financing = await this.checkFinancingLimit(userId, amount);
      if (!financing.available) {
        throw new Error(financing.error!);
      }
      sourceType = 'FINANCING';
    }

    // Crear transacción
    const idempotencyKey = `${userId}-${destination.cvu}-${amount}-${Date.now()}`;

    const transaction = await prisma.$transaction(async (tx) => {
      // Debitar origen
      if (sourceType === 'ACCOUNT') {
        await tx.accounts.update({
          where: { id: user.account!.id },
          data: { balance: { decrement: amount } }
        });
      } else {
        // Obtener inversión activa para vincular
        const activeInvestment = await tx.investments.findFirst({
          where: { user_id: userId, status: 'ACTIVE' },
          orderBy: { current_value: 'desc' }
        });

        if (!activeInvestment) {
          throw new Error('No tienes inversiones activas para financiar');
        }

        const installmentAmount = amount / installments!;
        const today = new Date();
        const nextDueDate = new Date(today);
        nextDueDate.setMonth(nextDueDate.getMonth() + 1);

        // Crear financiación
        const newFinancing = await tx.financings.create({
          data: {
            user_id: userId,
            investment_id: activeInvestment.id,
            amount: new Prisma.Decimal(amount),
            total_amount: new Prisma.Decimal(amount),
            remaining: new Prisma.Decimal(amount),
            installments: installments!,
            installment_amount: new Prisma.Decimal(installmentAmount),
            interest_rate: 0,
            destination_type: 'TRANSFER',
            destination_ref: destination.cvu,
            description: `Transferencia a ${destination.holderName}`,
            status: 'ACTIVE',
            next_due_date: nextDueDate
          }
        });
        financingId = newFinancing.id;

        // Crear cuotas
        for (let i = 1; i <= installments!; i++) {
          const dueDate = new Date(today);
          dueDate.setMonth(dueDate.getMonth() + i);

          await tx.installments.create({
            data: {
              financing_id: newFinancing.id,
              number: i,
              amount: new Prisma.Decimal(installmentAmount),
              due_date: dueDate,
              status: 'PENDING'
            }
          });
        }
      }

      // Acreditar destino (si es interno)
      const internalDest = await tx.accounts.findUnique({ where: { cvu: destination.cvu } });
      if (internalDest) {
        await tx.accounts.update({
          where: { id: internalDest.id },
          data: { balance: { increment: amount } }
        });
      }
      // TODO: Si es externo, enviar vía BIND API

      // Registrar transacción saliente
      const txOut = await tx.transactions.create({
        data: {
          user_id: userId,
          account_id: user.account!.id,
          type: 'TRANSFER_OUT',
          amount: new Prisma.Decimal(amount),
          total: new Prisma.Decimal(amount),
          currency: 'ARS',
          status: 'COMPLETED',
          description: `Transferencia a ${destination.holderName}`,
          destination_cvu: destination.cvu,
          motive: MOTIVOS_BCRA[motive],
          reference: reference || null,
          metadata: {
            sourceType,
            financingId,
            installments: installments || null,
            fraudScore: fraudCheck.score,
            idempotencyKey,
            destinationBank: destination.bank
          },
          completed_at: new Date()
        }
      });

      // Registrar transacción entrante (si es interno)
      if (internalDest) {
        await tx.transactions.create({
          data: {
            user_id: internalDest.user_id,
            account_id: internalDest.id,
            type: 'TRANSFER_IN',
            amount: new Prisma.Decimal(amount),
            total: new Prisma.Decimal(amount),
            currency: 'ARS',
            status: 'COMPLETED',
            description: `Transferencia de ${user.first_name} ${user.last_name}`,
            origin_cvu: user.account!.cvu,
            motive: MOTIVOS_BCRA[motive],
            reference: reference || null,
            completed_at: new Date()
          }
        });
      }

      return txOut;
    });

    // Audit log
    await auditLogService.log({
      action: 'TRANSFER_COMPLETED',
      actorType: 'user',
      actorId: userId,
      resource: 'transaction',
      resourceId: transaction.id,
      description: `Transferencia $${amount} a ${destination.cvu}`,
      metadata: { sourceType, installments }
    });

    return {
      success: true,
      transactionId: transaction.id,
      amount,
      destination: {
        cvu: destination.cvu,
        holderName: destination.holderName,
        bank: destination.bank
      },
      sourceType,
      financingId,
      completedAt: transaction.completed_at
    };
  },

  async getDailyTransferTotal(userId: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result = await prisma.transactions.aggregate({
      where: {
        user_id: userId,
        type: 'TRANSFER_OUT',
        status: 'COMPLETED',
        created_at: { gte: today }
      },
      _sum: { amount: true }
    });

    return Number(result._sum.amount) || 0;
  },

  async getMonthlyTransferTotal(userId: string): Promise<number> {
    const firstOfMonth = new Date();
    firstOfMonth.setDate(1);
    firstOfMonth.setHours(0, 0, 0, 0);

    const result = await prisma.transactions.aggregate({
      where: {
        user_id: userId,
        type: 'TRANSFER_OUT',
        status: 'COMPLETED',
        created_at: { gte: firstOfMonth }
      },
      _sum: { amount: true }
    });

    return Number(result._sum.amount) || 0;
  },

  async checkFinancingLimit(userId: string, amount: number) {
    // Obtener inversión activa
    const investments = await prisma.investments.aggregate({
      where: { user_id: userId, status: 'ACTIVE' },
      _sum: { current_value: true }
    });

    const totalInvested = Number(investments._sum.current_value) || 0;

    // Obtener financiación usada
    const financings = await prisma.financings.aggregate({
      where: { user_id: userId, status: 'ACTIVE' },
      _sum: { remaining: true }
    });

    const usedFinancing = Number(financings._sum.remaining) || 0;

    // Calcular límite (15% de inversión según nivel)
    const user = await prisma.users.findUnique({ where: { id: userId } });
    const levelMultiplier: Record<string, number> = {
      PLATA: 0.07,
      ORO: 0.10,
      BLACK: 0.13,
      DIAMANTE: 0.15
    };

    const maxFinancing = totalInvested * (levelMultiplier[user?.user_level || 'PLATA'] || 0.07);
    const availableFinancing = maxFinancing - usedFinancing;

    if (amount > availableFinancing) {
      return {
        available: false,
        error: `Límite de financiación excedido. Disponible: $${Math.floor(availableFinancing)}`
      };
    }

    return { available: true, availableLimit: availableFinancing };
  },

  // ==========================================
  // HISTORIAL DE TRANSFERENCIAS
  // ==========================================

  async getHistory(userId: string, params: { page?: number; limit?: number; type?: 'in' | 'out' | 'all' }) {
    const { page = 1, limit = 20, type = 'all' } = params;

    const where: any = { user_id: userId };

    if (type === 'in') {
      where.type = 'TRANSFER_IN';
    } else if (type === 'out') {
      where.type = 'TRANSFER_OUT';
    } else {
      where.type = { in: ['TRANSFER_IN', 'TRANSFER_OUT'] };
    }

    const [transactions, total] = await Promise.all([
      prisma.transactions.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.transactions.count({ where })
    ]);

    return {
      transactions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }
};
