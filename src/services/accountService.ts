import { PrismaClient, Prisma } from '@prisma/client';
import { auditLogService } from './backoffice/auditLogService';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Código de entidad Simply (ficticio - en producción viene de BCRA)
const ENTITY_CODE = '0000072'; // 7 dígitos
const BRANCH_CODE = '0'; // 1 dígito

export const accountService = {
  // ==========================================
  // GENERAR CVU
  // ==========================================

  async generateCVU(userId: string): Promise<string> {
    const user = await prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new Error('Usuario no encontrado');

    // Verificar si ya tiene cuenta
    const existingAccount = await prisma.accounts.findUnique({ where: { user_id: userId } });
    if (existingAccount) {
      return existingAccount.cvu;
    }

    // Generar número de cuenta único (13 dígitos)
    let accountNumber: string;
    let attempts = 0;

    do {
      // Usar DNI + random para mayor unicidad
      const dniPart = (user.dni || '').padStart(8, '0').slice(-8);
      const randomPart = crypto.randomInt(10000, 99999).toString();
      accountNumber = dniPart + randomPart; // 13 dígitos
      attempts++;

      if (attempts > 100) {
        throw new Error('No se pudo generar CVU único');
      }
    } while (await this.cvuExists(this.buildCVU(accountNumber)));

    const cvu = this.buildCVU(accountNumber);

    // Generar alias por defecto
    const alias = await this.generateDefaultAlias(user.first_name, user.last_name);

    // Crear cuenta
    await prisma.accounts.create({
      data: {
        user_id: userId,
        cvu,
        alias,
        balance: 0,
        daily_limit: this.getLimitByLevel(user.user_level, 'daily'),
        monthly_limit: this.getLimitByLevel(user.user_level, 'monthly')
      }
    });

    await auditLogService.log({
      action: 'ACCOUNT_CREATED',
      actorType: 'system',
      resource: 'account',
      resourceId: cvu,
      description: `CVU generado para usuario ${userId}`,
      metadata: { cvu, alias }
    });

    return cvu;
  },

  buildCVU(accountNumber: string): string {
    // Estructura CVU: 7 dígitos entidad + 1 check + 13 dígitos cuenta + 1 check = 22
    const block1 = ENTITY_CODE; // 7 dígitos
    const check1 = this.calculateCheck1(block1);

    const block2 = BRANCH_CODE + accountNumber; // 14 dígitos (1+13)
    const check2 = this.calculateCheck2(block2);

    return block1 + check1 + block2.slice(0, 13) + check2;
  },

  calculateCheck1(block: string): string {
    const weights = [7, 1, 3, 9, 7, 1, 3];
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      sum += parseInt(block[i]) * weights[i];
    }
    return ((10 - (sum % 10)) % 10).toString();
  },

  calculateCheck2(block: string): string {
    const weights = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3];
    let sum = 0;
    for (let i = 0; i < 13; i++) {
      sum += parseInt(block[i]) * weights[i];
    }
    return ((10 - (sum % 10)) % 10).toString();
  },

  async cvuExists(cvu: string): Promise<boolean> {
    const exists = await prisma.accounts.findUnique({ where: { cvu } });
    return !!exists;
  },

  async generateDefaultAlias(firstName: string, lastName: string): Promise<string> {
    const base = `${firstName}.${lastName}`.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remover acentos
      .replace(/[^a-z0-9.]/g, '') // Solo alfanumérico y punto
      .slice(0, 15);

    let alias = base + '.simply';
    let counter = 0;

    while (await this.aliasExists(alias)) {
      counter++;
      alias = `${base}${counter}.simply`;
    }

    return alias;
  },

  async aliasExists(alias: string): Promise<boolean> {
    const exists = await prisma.accounts.findFirst({ where: { alias } });
    return !!exists;
  },

  getLimitByLevel(level: string, type: 'daily' | 'monthly'): Prisma.Decimal {
    const limits: Record<string, { daily: number; monthly: number }> = {
      PLATA: { daily: 500000, monthly: 5000000 },
      ORO: { daily: 1000000, monthly: 10000000 },
      BLACK: { daily: 2500000, monthly: 25000000 },
      DIAMANTE: { daily: 5000000, monthly: 50000000 }
    };

    const levelLimits = limits[level] || limits.PLATA;
    return new Prisma.Decimal(type === 'daily' ? levelLimits.daily : levelLimits.monthly);
  },

  // ==========================================
  // CAMBIAR ALIAS
  // ==========================================

  async changeAlias(userId: string, newAlias: string) {
    const account = await prisma.accounts.findUnique({ where: { user_id: userId } });
    if (!account) throw new Error('Cuenta no encontrada');

    // Validar formato de alias
    if (!/^[a-z0-9.]{6,20}$/.test(newAlias)) {
      throw new Error('Alias inválido. Debe tener 6-20 caracteres, solo letras minúsculas, números y puntos.');
    }

    // Verificar cambios disponibles (1 gratis, luego $500 c/u)
    const changeCount = account.alias_changes || 0;
    const fee = changeCount >= 1 ? 500 : 0;

    if (fee > 0 && Number(account.balance) < fee) {
      throw new Error(`Saldo insuficiente. Costo del cambio: $${fee}`);
    }

    // Verificar disponibilidad
    if (await this.aliasExists(newAlias)) {
      throw new Error('Este alias ya está en uso');
    }

    const oldAlias = account.alias;

    // Actualizar
    await prisma.$transaction([
      prisma.accounts.update({
        where: { id: account.id },
        data: {
          alias: newAlias,
          alias_changes: { increment: 1 },
          ...(fee > 0 && { balance: { decrement: fee } })
        }
      }),
      ...(fee > 0 ? [
        prisma.transactions.create({
          data: {
            user_id: userId,
            account_id: account.id,
            type: 'SERVICE_PAYMENT',
            amount: new Prisma.Decimal(fee),
            total: new Prisma.Decimal(fee),
            currency: 'ARS',
            status: 'COMPLETED',
            description: 'Cambio de alias',
            completed_at: new Date()
          }
        })
      ] : [])
    ]);

    await auditLogService.log({
      action: 'ALIAS_CHANGED',
      actorType: 'user',
      actorId: userId,
      resource: 'account',
      resourceId: account.id,
      description: `Alias cambiado de ${oldAlias} a ${newAlias}`,
      metadata: { oldAlias, newAlias, fee }
    });

    return { success: true, newAlias, fee };
  },

  // ==========================================
  // CAÍDA DE CUOTAS (Liquidación anticipada + 3% penalización)
  // ==========================================

  async earlyCloseFinancing(userId: string, financingId: string, reason?: string) {
    const financing = await prisma.financings.findFirst({
      where: { id: financingId, user_id: userId, status: 'ACTIVE' }
    });

    if (!financing) {
      throw new Error('Financiación no encontrada o ya cerrada');
    }

    const remainingAmount = Number(financing.remaining);
    const penalty = Math.round(remainingAmount * 0.03 * 100) / 100; // 3% penalización
    const totalToCollect = remainingAmount + penalty;

    // Verificar inversión activa
    const investments = await prisma.investments.findMany({
      where: { user_id: userId, status: 'ACTIVE' },
      orderBy: { current_value: 'desc' }
    });

    const totalInvested = investments.reduce((sum, inv) => sum + Number(inv.current_value), 0);

    if (totalInvested < totalToCollect) {
      throw new Error(`Inversión insuficiente para cubrir caída. Necesitas: $${totalToCollect}, Tienes invertido: $${totalInvested}`);
    }

    // Ejecutar caída de cuotas
    const result = await prisma.$transaction(async (tx) => {
      // 1. Liquidar inversiones necesarias
      let amountToLiquidate = totalToCollect;
      const liquidatedInvestments: string[] = [];

      for (const inv of investments) {
        if (amountToLiquidate <= 0) break;

        const invValue = Number(inv.current_value);
        const toLiquidate = Math.min(invValue, amountToLiquidate);

        if (toLiquidate >= invValue) {
          // Liquidar completa
          await tx.investments.update({
            where: { id: inv.id },
            data: { status: 'COMPLETED', current_value: 0 }
          });
        } else {
          // Liquidar parcial
          await tx.investments.update({
            where: { id: inv.id },
            data: { current_value: { decrement: toLiquidate } }
          });
        }

        liquidatedInvestments.push(inv.id);
        amountToLiquidate -= toLiquidate;
      }

      // 2. Marcar cuotas pendientes como pagadas
      await tx.installments.updateMany({
        where: { financing_id: financingId, status: 'PENDING' },
        data: { status: 'PAID', paid_at: new Date() }
      });

      // 3. Cerrar financiación
      await tx.financings.update({
        where: { id: financingId },
        data: {
          status: 'COMPLETED',
          remaining: 0,
          completed_at: new Date(),
          penalty_applied: true,
          penalty_amount: new Prisma.Decimal(penalty),
          description: `Caída de cuotas${reason ? `: ${reason}` : ''}`
        }
      });

      // 4. Registrar transacción de penalización
      const account = await tx.accounts.findUnique({ where: { user_id: userId } });
      
      await tx.transactions.create({
        data: {
          user_id: userId,
          account_id: account!.id,
          type: 'PENALTY_CHARGE',
          amount: new Prisma.Decimal(penalty),
          total: new Prisma.Decimal(penalty),
          currency: 'ARS',
          status: 'COMPLETED',
          description: `Penalización 3% por caída de cuotas - Financiación ${financingId.slice(-8)}`,
          completed_at: new Date()
        }
      });

      // 5. Registrar transacción de liquidación
      await tx.transactions.create({
        data: {
          user_id: userId,
          account_id: account!.id,
          type: 'INVESTMENT_WITHDRAWAL',
          amount: new Prisma.Decimal(remainingAmount),
          total: new Prisma.Decimal(remainingAmount),
          currency: 'ARS',
          status: 'COMPLETED',
          description: `Liquidación por caída de cuotas - Financiación ${financingId.slice(-8)}`,
          completed_at: new Date()
        }
      });

      // 6. Si sobra algo después de liquidar, acreditar en cuenta
      const surplus = totalInvested - totalToCollect;
      if (surplus > 0) {
        await tx.accounts.update({
          where: { user_id: userId },
          data: { balance: { increment: surplus } }
        });

        await tx.transactions.create({
          data: {
            user_id: userId,
            account_id: account!.id,
            type: 'INVESTMENT_WITHDRAWAL',
            amount: new Prisma.Decimal(surplus),
            total: new Prisma.Decimal(surplus),
            currency: 'ARS',
            status: 'COMPLETED',
            description: 'Remanente de liquidación FCI',
            completed_at: new Date()
          }
        });
      }

      return {
        financingId,
        remainingAmount,
        penalty,
        totalCollected: totalToCollect,
        liquidatedInvestments,
        surplus: surplus > 0 ? surplus : 0
      };
    });

    await auditLogService.log({
      action: 'FINANCING_EARLY_CLOSED',
      actorType: 'user',
      actorId: userId,
      resource: 'financing',
      resourceId: financingId,
      description: `Caída de cuotas: $${remainingAmount} + penalización $${penalty}`,
      severity: 'HIGH',
      metadata: result
    });

    return {
      success: true,
      ...result,
      message: `Financiación cerrada. Se liquidaron $${totalToCollect} (incluye $${penalty} de penalización)`
    };
  },

  // ==========================================
  // CONSULTAR LÍMITES
  // ==========================================

  async getLimits(userId: string) {
    const account = await prisma.accounts.findUnique({
      where: { user_id: userId },
      include: { user: { select: { user_level: true } } }
    });

    if (!account) throw new Error('Cuenta no encontrada');

    // Calcular uso del día
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dailyUsed = await prisma.transactions.aggregate({
      where: {
        user_id: userId,
        type: 'TRANSFER_OUT',
        status: 'COMPLETED',
        created_at: { gte: today }
      },
      _sum: { amount: true }
    });

    // Calcular uso del mes
    const firstOfMonth = new Date();
    firstOfMonth.setDate(1);
    firstOfMonth.setHours(0, 0, 0, 0);

    const monthlyUsed = await prisma.transactions.aggregate({
      where: {
        user_id: userId,
        type: 'TRANSFER_OUT',
        status: 'COMPLETED',
        created_at: { gte: firstOfMonth }
      },
      _sum: { amount: true }
    });

    return {
      level: account.user.user_level,
      daily: {
        limit: Number(account.daily_limit),
        used: Number(dailyUsed._sum.amount) || 0,
        available: Number(account.daily_limit) - (Number(dailyUsed._sum.amount) || 0)
      },
      monthly: {
        limit: Number(account.monthly_limit),
        used: Number(monthlyUsed._sum.amount) || 0,
        available: Number(account.monthly_limit) - (Number(monthlyUsed._sum.amount) || 0)
      },
      aliasChanges: account.alias_changes,
      nextAliasChangeFee: account.alias_changes >= 1 ? 500 : 0
    };
  }
};
