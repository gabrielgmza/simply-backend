import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface DashboardData {
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    level: string;
    levelColor: string;
    avatar?: string;
    kycStatus: string;
  };
  account: {
    cvu: string;
    alias: string;
    balance: number;
    balanceUsd: number;
    balancePending: number;
    dailyLimitUsed: number;
    dailyLimitTotal: number;
  } | null;
  investments: {
    totalInvested: number;
    currentValue: number;
    totalReturns: number;
    todayReturn: number;
    activeCount: number;
    financingLimit: number;
    financingUsed: number;
    financingAvailable: number;
  };
  financings: {
    activeCount: number;
    totalRemaining: number;
    nextInstallment: {
      amount: number;
      dueDate: string;
      daysLeft: number;
    } | null;
    overdueCount: number;
    overdueAmount: number;
  };
  transactions: {
    recent: Array<{
      id: string;
      type: string;
      amount: number;
      description: string;
      date: string;
      status: string;
    }>;
  };
  notifications: {
    unreadCount: number;
    recent: Array<{
      id: string;
      title: string;
      body: string;
      type: string;
      date: string;
      read: boolean;
    }>;
  };
  rewards: {
    points: number;
    lifetimePoints: number;
    pendingCashback: number;
    tier: string;
    tierProgress: number;
    nextTierPoints: number;
  };
  alerts: Array<{
    type: 'warning' | 'info' | 'success' | 'error';
    title: string;
    message: string;
    action?: string;
    actionRoute?: string;
  }>;
  quickActions: Array<{
    id: string;
    label: string;
    icon: string;
    route: string;
    badge?: number;
  }>;
}

const LEVEL_COLORS: Record<string, string> = {
  PLATA: '#94a3b8',
  ORO: '#fbbf24',
  BLACK: '#1f2937',
  DIAMANTE: '#60a5fa'
};

const LEVEL_MULTIPLIERS: Record<string, number> = {
  PLATA: 0.07,
  ORO: 0.10,
  BLACK: 0.13,
  DIAMANTE: 0.15
};

export const mobileDashboardService = {
  // ==========================================
  // DASHBOARD PRINCIPAL
  // ==========================================

  async getDashboard(userId: string): Promise<DashboardData> {
    const user = await prisma.users.findUnique({
      where: { id: userId },
      include: { account: true }
    });

    if (!user) throw new Error('Usuario no encontrado');

    // Ejecutar consultas en paralelo
    const [
      investments,
      financings,
      recentTransactions,
      notifications,
      todayReturn,
      overdueInstallments,
      nextInstallment,
      dailyUsed
    ] = await Promise.all([
      // Inversiones activas
      prisma.investments.aggregate({
        where: { user_id: userId, status: 'ACTIVE' },
        _sum: { amount: true, current_value: true, returns_earned: true },
        _count: true
      }),

      // Financiaciones activas
      prisma.financings.aggregate({
        where: { user_id: userId, status: 'ACTIVE' },
        _sum: { remaining: true },
        _count: true
      }),

      // Últimas transacciones
      prisma.transactions.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        take: 10,
        select: {
          id: true,
          type: true,
          amount: true,
          description: true,
          created_at: true,
          status: true
        }
      }),

      // Notificaciones
      prisma.user_notifications.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        take: 5,
        select: {
          id: true,
          title: true,
          body: true,
          type: true,
          created_at: true,
          read: true
        }
      }),

      // Rendimiento de hoy
      prisma.daily_returns.aggregate({
        where: {
          investment: { user_id: userId },
          date: { gte: new Date(new Date().setHours(0, 0, 0, 0)) }
        },
        _sum: { amount: true }
      }),

      // Cuotas vencidas
      prisma.installments.findMany({
        where: {
          financing: { user_id: userId, status: 'ACTIVE' },
          status: 'PENDING',
          due_date: { lt: new Date() }
        },
        select: { amount: true }
      }),

      // Próxima cuota
      prisma.installments.findFirst({
        where: {
          financing: { user_id: userId, status: 'ACTIVE' },
          status: 'PENDING',
          due_date: { gte: new Date() }
        },
        orderBy: { due_date: 'asc' },
        select: { amount: true, due_date: true }
      }),

      // Uso diario de límite
      this.getDailyTransferTotal(userId)
    ]);

    // Calcular totales
    const totalInvested = Number(investments._sum.amount) || 0;
    const currentValue = Number(investments._sum.current_value) || 0;
    const totalReturns = Number(investments._sum.returns_earned) || 0;
    const financingLimit = totalInvested * (LEVEL_MULTIPLIERS[user.user_level] || 0.07);
    const financingUsed = Number(financings._sum.remaining) || 0;

    // Calcular días para próxima cuota
    let nextInstallmentData = null;
    if (nextInstallment) {
      const daysLeft = Math.ceil((nextInstallment.due_date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      nextInstallmentData = {
        amount: Number(nextInstallment.amount),
        dueDate: nextInstallment.due_date.toISOString(),
        daysLeft: Math.max(0, daysLeft)
      };
    }

    // Cuotas vencidas
    const overdueAmount = overdueInstallments.reduce((sum, i) => sum + Number(i.amount), 0);

    // Contar notificaciones no leídas
    const unreadCount = await prisma.user_notifications.count({
      where: { user_id: userId, read: false }
    });

    // Generar alertas
    const alerts = this.generateAlerts({
      kycStatus: user.kyc_status,
      overdueCount: overdueInstallments.length,
      overdueAmount,
      balance: Number(user.account?.balance) || 0,
      nextInstallment: nextInstallmentData,
      financingUsedPercent: financingLimit > 0 ? (financingUsed / financingLimit) * 100 : 0
    });

    // Quick actions basadas en estado
    const quickActions = this.getQuickActions(user.kyc_status, overdueInstallments.length);

    return {
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        level: user.user_level,
        levelColor: LEVEL_COLORS[user.user_level] || LEVEL_COLORS.PLATA,
        kycStatus: user.kyc_status
      },
      account: user.account ? {
        cvu: user.account.cvu,
        alias: user.account.alias || '',
        balance: Number(user.account.balance),
        balanceUsd: Number(user.account.balance_usd) || 0,
        balancePending: Number(user.account.balance_pending) || 0,
        dailyLimitUsed: dailyUsed,
        dailyLimitTotal: Number(user.account.daily_limit)
      } : null,
      investments: {
        totalInvested,
        currentValue,
        totalReturns,
        todayReturn: Number(todayReturn._sum.amount) || 0,
        activeCount: investments._count,
        financingLimit,
        financingUsed,
        financingAvailable: Math.max(0, financingLimit - financingUsed)
      },
      financings: {
        activeCount: financings._count,
        totalRemaining: financingUsed,
        nextInstallment: nextInstallmentData,
        overdueCount: overdueInstallments.length,
        overdueAmount
      },
      transactions: {
        recent: recentTransactions.map(t => ({
          id: t.id,
          type: t.type,
          amount: Number(t.amount),
          description: t.description || '',
          date: t.created_at.toISOString(),
          status: t.status
        }))
      },
      notifications: {
        unreadCount,
        recent: notifications.map(n => ({
          id: n.id,
          title: n.title,
          body: n.body,
          type: n.type,
          date: n.created_at.toISOString(),
          read: n.read
        }))
      },
      rewards: {
        points: user.points_balance,
        lifetimePoints: user.lifetime_points,
        pendingCashback: 0, // TODO: calcular cashback pendiente
        tier: user.user_level,
        tierProgress: this.calculateTierProgress(user.user_level, totalInvested),
        nextTierPoints: this.getNextTierThreshold(user.user_level)
      },
      alerts,
      quickActions
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

  generateAlerts(data: {
    kycStatus: string;
    overdueCount: number;
    overdueAmount: number;
    balance: number;
    nextInstallment: { amount: number; daysLeft: number } | null;
    financingUsedPercent: number;
  }) {
    const alerts: DashboardData['alerts'] = [];

    // KYC pendiente
    if (data.kycStatus === 'PENDING' || data.kycStatus === 'IN_PROGRESS') {
      alerts.push({
        type: 'warning',
        title: 'Verificá tu identidad',
        message: 'Completá la verificación para operar sin límites.',
        action: 'Verificar ahora',
        actionRoute: '/kyc'
      });
    }

    // KYC rechazado
    if (data.kycStatus === 'REJECTED') {
      alerts.push({
        type: 'error',
        title: 'Verificación rechazada',
        message: 'Hubo un problema con tu verificación. Intentá nuevamente.',
        action: 'Reintentar',
        actionRoute: '/kyc'
      });
    }

    // Cuotas vencidas
    if (data.overdueCount > 0) {
      alerts.push({
        type: 'error',
        title: `${data.overdueCount} cuota${data.overdueCount > 1 ? 's' : ''} vencida${data.overdueCount > 1 ? 's' : ''}`,
        message: `Debés $${data.overdueAmount.toLocaleString('es-AR')}. Pagá para evitar penalizaciones.`,
        action: 'Pagar ahora',
        actionRoute: '/financings'
      });
    }

    // Cuota próxima a vencer
    if (data.nextInstallment && data.nextInstallment.daysLeft <= 3 && data.nextInstallment.daysLeft > 0) {
      alerts.push({
        type: 'warning',
        title: 'Cuota próxima a vencer',
        message: `Tu cuota de $${data.nextInstallment.amount.toLocaleString('es-AR')} vence en ${data.nextInstallment.daysLeft} día${data.nextInstallment.daysLeft > 1 ? 's' : ''}.`,
        action: 'Ver detalle',
        actionRoute: '/financings'
      });
    }

    // Saldo bajo
    if (data.balance > 0 && data.balance < 1000) {
      alerts.push({
        type: 'info',
        title: 'Saldo bajo',
        message: 'Tu saldo está por debajo de $1.000. Recargá para seguir operando.',
        action: 'Recargar',
        actionRoute: '/deposit'
      });
    }

    // Límite de financiación casi agotado
    if (data.financingUsedPercent >= 90) {
      alerts.push({
        type: 'info',
        title: 'Límite de financiación casi agotado',
        message: 'Invertí más para aumentar tu límite disponible.',
        action: 'Invertir',
        actionRoute: '/invest'
      });
    }

    return alerts;
  },

  getQuickActions(kycStatus: string, overdueCount: number) {
    const actions: DashboardData['quickActions'] = [];

    // Acciones prioritarias según estado
    if (overdueCount > 0) {
      actions.push({
        id: 'pay-overdue',
        label: 'Pagar cuotas',
        icon: 'alert-circle',
        route: '/financings',
        badge: overdueCount
      });
    }

    if (kycStatus !== 'APPROVED') {
      actions.push({
        id: 'verify',
        label: 'Verificar',
        icon: 'shield-check',
        route: '/kyc'
      });
    }

    // Acciones estándar
    actions.push(
      { id: 'transfer', label: 'Transferir', icon: 'send', route: '/transfer' },
      { id: 'invest', label: 'Invertir', icon: 'trending-up', route: '/invest' },
      { id: 'pay', label: 'Pagar', icon: 'credit-card', route: '/payments' },
      { id: 'qr', label: 'QR', icon: 'qr-code', route: '/qr' }
    );

    return actions.slice(0, 4); // Máximo 4 acciones rápidas
  },

  calculateTierProgress(currentLevel: string, totalInvested: number): number {
    const thresholds: Record<string, { min: number; max: number }> = {
      PLATA: { min: 0, max: 10000000 },
      ORO: { min: 10000000, max: 50000000 },
      BLACK: { min: 50000000, max: 150000000 },
      DIAMANTE: { min: 150000000, max: 500000000 }
    };

    const tier = thresholds[currentLevel] || thresholds.PLATA;
    if (totalInvested >= tier.max) return 100;
    if (totalInvested <= tier.min) return 0;

    return Math.round(((totalInvested - tier.min) / (tier.max - tier.min)) * 100);
  },

  getNextTierThreshold(currentLevel: string): number {
    const thresholds: Record<string, number> = {
      PLATA: 10000000,
      ORO: 50000000,
      BLACK: 150000000,
      DIAMANTE: 500000000
    };
    return thresholds[currentLevel] || 10000000;
  },

  // ==========================================
  // RESUMEN RÁPIDO (widget)
  // ==========================================

  async getQuickSummary(userId: string) {
    const user = await prisma.users.findUnique({
      where: { id: userId },
      include: { account: true }
    });

    if (!user) throw new Error('Usuario no encontrado');

    const [unreadCount, overdueCount] = await Promise.all([
      prisma.user_notifications.count({ where: { user_id: userId, read: false } }),
      prisma.installments.count({
        where: {
          financing: { user_id: userId, status: 'ACTIVE' },
          status: 'PENDING',
          due_date: { lt: new Date() }
        }
      })
    ]);

    return {
      balance: Number(user.account?.balance) || 0,
      level: user.user_level,
      unreadNotifications: unreadCount,
      overdueInstallments: overdueCount,
      hasAlerts: overdueCount > 0 || user.kyc_status !== 'APPROVED'
    };
  }
};
