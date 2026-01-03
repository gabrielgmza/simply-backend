import { PrismaClient, Prisma } from '@prisma/client';
import { auditLogService } from './auditLogService';

const prisma = new PrismaClient();

export type RewardType = 'CASHBACK' | 'POINTS' | 'BONUS_RATE' | 'FEE_WAIVER' | 'REFERRAL';
export type RewardStatus = 'PENDING' | 'EARNED' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED';

const LEVEL_MULTIPLIERS: Record<string, number> = { PLATA: 1.0, ORO: 1.25, BLACK: 1.5, DIAMANTE: 2.0 };
const BASE_POINTS_PER_PESO = 0.01;

export const rewardsService = {
  async getBalance(userId: string) {
    const user = await prisma.users.findUnique({ where: { id: userId }, select: { user_level: true } });

    const [rewards, pending, redeemed] = await Promise.all([
      prisma.user_rewards.aggregate({ where: { user_id: userId, status: 'EARNED' }, _sum: { points: true, amount: true } }),
      prisma.user_rewards.aggregate({ where: { user_id: userId, status: 'PENDING' }, _sum: { points: true, amount: true } }),
      prisma.user_rewards.aggregate({ where: { user_id: userId, status: 'REDEEMED' }, _sum: { points: true, amount: true } })
    ]);

    const multiplier = LEVEL_MULTIPLIERS[user?.user_level || 'PLATA'] || 1;

    return {
      availablePoints: Number(rewards._sum.points || 0),
      availableCashback: Number(rewards._sum.amount || 0),
      pendingPoints: Number(pending._sum.points || 0),
      pendingCashback: Number(pending._sum.amount || 0),
      totalRedeemed: Number(redeemed._sum.amount || 0),
      currentMultiplier: multiplier,
      level: user?.user_level || 'PLATA'
    };
  },

  async getHistory(userId: string, params?: { page?: number; limit?: number; type?: RewardType; status?: RewardStatus }) {
    const page = params?.page || 1;
    const limit = params?.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { user_id: userId };
    if (params?.type) where.type = params.type;
    if (params?.status) where.status = params.status;

    const [rewards, total] = await Promise.all([
      prisma.user_rewards.findMany({ where, orderBy: { created_at: 'desc' }, skip, take: limit }),
      prisma.user_rewards.count({ where })
    ]);

    return { rewards, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  },

  async grantInvestmentReward(userId: string, investmentId: string, amount: number) {
    const user = await prisma.users.findUnique({ where: { id: userId }, select: { user_level: true } });
    const multiplier = LEVEL_MULTIPLIERS[user?.user_level || 'PLATA'] || 1;
    const points = Math.floor(amount * BASE_POINTS_PER_PESO * multiplier);
    const cashback = amount * 0.005 * multiplier;

    return prisma.user_rewards.create({
      data: {
        user_id: userId,
        type: 'POINTS',
        points,
        amount: new Prisma.Decimal(cashback),
        status: 'PENDING',
        source_type: 'INVESTMENT',
        source_id: investmentId,
        description: `Reward por inversión de $${amount.toLocaleString()}`,
        expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      }
    });
  },

  async grantReferralReward(referrerId: string, referredUserId: string, amount: number = 5000) {
    return prisma.user_rewards.create({
      data: {
        user_id: referrerId,
        type: 'REFERRAL',
        points: 500,
        amount: new Prisma.Decimal(amount),
        status: 'PENDING',
        source_type: 'REFERRAL',
        source_id: referredUserId,
        description: `Bonus por referir un nuevo usuario`,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
      }
    });
  },

  async confirmPendingRewards(userId: string, sourceType: string, sourceId: string) {
    const result = await prisma.user_rewards.updateMany({
      where: { user_id: userId, source_type: sourceType, source_id: sourceId, status: 'PENDING' },
      data: { status: 'EARNED' }
    });
    return result.count;
  },

  async redeemPoints(userId: string, points: number, employeeId?: string) {
    const balance = await this.getBalance(userId);
    if (points > balance.availablePoints) throw new Error('Puntos insuficientes');

    const cashbackAmount = points / 100;

    const toRedeem = await prisma.user_rewards.findMany({
      where: { user_id: userId, status: 'EARNED', points: { gt: 0 } },
      orderBy: { expires_at: 'asc' }
    });

    let remainingPoints = points;
    for (const reward of toRedeem) {
      if (remainingPoints <= 0) break;
      const redeemFromThis = Math.min(reward.points || 0, remainingPoints);
      remainingPoints -= redeemFromThis;

      await prisma.user_rewards.update({
        where: { id: reward.id },
        data: {
          status: redeemFromThis >= (reward.points || 0) ? 'REDEEMED' : 'EARNED',
          points: (reward.points || 0) - redeemFromThis
        }
      });
    }

    await prisma.transactions.create({
      data: {
        user_id: userId,
        type: 'TRANSFER_IN',
        amount: new Prisma.Decimal(cashbackAmount),
        status: 'COMPLETED',
        description: `Canje de ${points} puntos`,
        metadata: { pointsRedeemed: points }
      }
    });

    if (employeeId) {
      await auditLogService.log({
        action: 'REWARD_REDEMPTION',
        actorType: 'employee',
        actorId: employeeId,
        resource: 'user',
        resourceId: userId,
        description: `Canje de ${points} puntos por $${cashbackAmount}`,
        metadata: { points, cashbackAmount }
      });
    }

    return { pointsRedeemed: points, cashbackAmount };
  },

  async expireRewards() {
    const result = await prisma.user_rewards.updateMany({
      where: { status: { in: ['PENDING', 'EARNED'] }, expires_at: { lt: new Date() } },
      data: { status: 'EXPIRED' }
    });
    return result.count;
  },

  async getStats() {
    const [totalIssued, totalRedeemed, totalPending, totalExpired] = await Promise.all([
      prisma.user_rewards.aggregate({ where: { status: 'EARNED' }, _sum: { points: true, amount: true } }),
      prisma.user_rewards.aggregate({ where: { status: 'REDEEMED' }, _sum: { points: true, amount: true } }),
      prisma.user_rewards.aggregate({ where: { status: 'PENDING' }, _sum: { points: true, amount: true } }),
      prisma.user_rewards.aggregate({ where: { status: 'EXPIRED' }, _sum: { points: true, amount: true } })
    ]);

    const byType = await prisma.user_rewards.groupBy({
      by: ['type'],
      _sum: { points: true, amount: true },
      _count: true
    });

    return {
      totalIssued: { points: Number(totalIssued._sum.points || 0), amount: Number(totalIssued._sum.amount || 0) },
      totalRedeemed: { points: Number(totalRedeemed._sum.points || 0), amount: Number(totalRedeemed._sum.amount || 0) },
      totalPending: { points: Number(totalPending._sum.points || 0), amount: Number(totalPending._sum.amount || 0) },
      totalExpired: { points: Number(totalExpired._sum.points || 0), amount: Number(totalExpired._sum.amount || 0) },
      byType: byType.map(t => ({ type: t.type, count: t._count, points: Number(t._sum.points || 0), amount: Number(t._sum.amount || 0) }))
    };
  },

  async getAll(params?: { page?: number; limit?: number; userId?: string; type?: string; status?: string }) {
    const page = params?.page || 1;
    const limit = params?.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (params?.userId) where.user_id = params.userId;
    if (params?.type) where.type = params.type;
    if (params?.status) where.status = params.status;

    const [rewards, total] = await Promise.all([
      prisma.user_rewards.findMany({
        where, orderBy: { created_at: 'desc' }, skip, take: limit,
        include: { users: { select: { first_name: true, last_name: true, email: true } } }
      }),
      prisma.user_rewards.count({ where })
    ]);

    return {
      rewards: rewards.map(r => ({
        ...r,
        points: r.points,
        amount: Number(r.amount),
        user: r.users ? `${r.users.first_name} ${r.users.last_name}` : null,
        userEmail: r.users?.email
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  },

  async grantManual(data: { userId: string; type: RewardType; points?: number; amount?: number; description: string; employeeId: string }) {
    const reward = await prisma.user_rewards.create({
      data: {
        user_id: data.userId,
        type: data.type,
        points: data.points || 0,
        amount: data.amount ? new Prisma.Decimal(data.amount) : new Prisma.Decimal(0),
        status: 'EARNED',
        source_type: 'MANUAL',
        source_id: data.employeeId,
        description: data.description,
        expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      }
    });

    await auditLogService.log({
      action: 'REWARD_GRANTED',
      actorType: 'employee',
      actorId: data.employeeId,
      resource: 'user',
      resourceId: data.userId,
      description: `Reward manual: ${data.description}`,
      metadata: { type: data.type, points: data.points, amount: data.amount }
    });

    return reward;
  },

  async cancel(rewardId: string, reason: string, employeeId: string) {
    const reward = await prisma.user_rewards.findUnique({ where: { id: rewardId } });
    if (!reward) throw new Error('Reward no encontrado');
    if (reward.status === 'REDEEMED') throw new Error('No se puede cancelar un reward ya canjeado');

    const updated = await prisma.user_rewards.update({
      where: { id: rewardId },
      data: { status: 'CANCELLED' }
    });

    await auditLogService.log({
      action: 'REWARD_CANCELLED',
      actorType: 'employee',
      actorId: employeeId,
      resource: 'reward',
      resourceId: rewardId,
      description: reason,
      metadata: { originalStatus: reward.status }
    });

    return updated;
  }
};
