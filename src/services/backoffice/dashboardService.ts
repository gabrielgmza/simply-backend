import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const dashboardService = {
  async getStats() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    // Usuarios
    const [totalUsers, activeUsers, newUsersThisMonth, newUsersLastMonth] = await Promise.all([
      prisma.users.count(),
      prisma.users.count({ where: { status: 'ACTIVE' } }),
      prisma.users.count({ where: { created_at: { gte: startOfMonth } } }),
      prisma.users.count({ where: { created_at: { gte: startOfLastMonth, lte: endOfLastMonth } } })
    ]);

    // Inversiones
    const investments = await prisma.investments.aggregate({
      where: { status: 'ACTIVE' },
      _sum: { current_value: true },
      _count: true
    });

    const investmentsLastMonth = await prisma.investments.aggregate({
      where: { status: 'ACTIVE', created_at: { lte: endOfLastMonth } },
      _sum: { current_value: true }
    });

    // Financiamientos
    const [activeFinancings, financingsLastMonth] = await Promise.all([
      prisma.financings.count({ where: { status: 'ACTIVE' } }),
      prisma.financings.count({ where: { status: 'ACTIVE', created_at: { lte: endOfLastMonth } } })
    ]);

    // Volumen mensual (transacciones)
    const monthlyTransactions = await prisma.transactions.aggregate({
      where: { created_at: { gte: startOfMonth }, status: 'COMPLETED' },
      _sum: { amount: true }
    });

    const lastMonthTransactions = await prisma.transactions.aggregate({
      where: { created_at: { gte: startOfLastMonth, lte: endOfLastMonth }, status: 'COMPLETED' },
      _sum: { amount: true }
    });

    // KYC Pendientes
    const pendingKYC = await prisma.users.count({
      where: { kyc_status: 'PENDING' }
    });

    // Alertas de fraude pendientes
    const pendingFraudAlerts = await prisma.fraud_alerts.count({
      where: { status: 'PENDING' }
    });

    // Tickets abiertos
    const openTickets = await prisma.tickets.count({
      where: { status: { in: ['OPEN', 'IN_PROGRESS'] } }
    });

    // Aprobaciones pendientes
    const pendingApprovals = await prisma.approval_requests.count({
      where: { status: 'PENDING' }
    });

    // Calcular cambios porcentuales
    const calcChange = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Number((((current - previous) / previous) * 100).toFixed(1));
    };

    const totalInvestments = Number(investments._sum.current_value || 0);
    const totalInvestmentsLast = Number(investmentsLastMonth._sum.current_value || 0);
    const monthlyVolume = Number(monthlyTransactions._sum.amount || 0);
    const lastMonthVolume = Number(lastMonthTransactions._sum.amount || 0);

    return {
      // Métricas principales
      totalUsers,
      activeUsers,
      totalInvestments,
      activeFinancings,
      monthlyVolume,
      
      // Cambios porcentuales
      usersChange: calcChange(newUsersThisMonth, newUsersLastMonth),
      investmentsChange: calcChange(totalInvestments, totalInvestmentsLast),
      financingsChange: calcChange(activeFinancings, financingsLastMonth),
      volumeChange: calcChange(monthlyVolume, lastMonthVolume),
      
      // Alertas
      pendingKYC,
      pendingFraudAlerts,
      openTickets,
      pendingApprovals,
      
      // Métricas de rendimiento (calculadas o mock por ahora)
      conversionRate: 68,
      retentionRate: 85,
      nplRate: 2.3,
      nps: 72
    };
  },

  async getGrowth(days: number = 30) {
    const data = [];
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const startOfDay = new Date(date.setHours(0, 0, 0, 0));
      const endOfDay = new Date(date.setHours(23, 59, 59, 999));

      const [users, investments, transactions] = await Promise.all([
        prisma.users.count({ where: { created_at: { lte: endOfDay } } }),
        prisma.investments.aggregate({
          where: { created_at: { lte: endOfDay }, status: 'ACTIVE' },
          _sum: { current_value: true }
        }),
        prisma.transactions.aggregate({
          where: { created_at: { gte: startOfDay, lte: endOfDay }, status: 'COMPLETED' },
          _sum: { amount: true }
        })
      ]);

      data.push({
        date: startOfDay.toISOString().split('T')[0],
        users,
        aum: Number(investments._sum.current_value || 0),
        volume: Number(transactions._sum.amount || 0)
      });
    }

    return data;
  },

  async getRecentActivity(limit: number = 10) {
    const [transactions, investments, financings] = await Promise.all([
      prisma.transactions.findMany({
        take: limit,
        orderBy: { created_at: 'desc' },
        include: { user: { select: { first_name: true, last_name: true, email: true } } }
      }),
      prisma.investments.findMany({
        take: limit,
        orderBy: { created_at: 'desc' },
        include: { user: { select: { first_name: true, last_name: true, email: true } } }
      }),
      prisma.financings.findMany({
        take: limit,
        orderBy: { created_at: 'desc' },
        include: { user: { select: { first_name: true, last_name: true, email: true } } }
      })
    ]);

    // Combinar y ordenar
    const activity = [
      ...transactions.map(t => ({
        type: 'transaction' as const,
        id: t.id,
        amount: Number(t.amount),
        status: t.status,
        user: t.user ? `${t.user.first_name} ${t.user.last_name}` : 'N/A',
        createdAt: t.created_at
      })),
      ...investments.map(i => ({
        type: 'investment' as const,
        id: i.id,
        amount: Number(i.amount),
        status: i.status,
        user: i.user ? `${i.user.first_name} ${i.user.last_name}` : 'N/A',
        createdAt: i.created_at
      })),
      ...financings.map(f => ({
        type: 'financing' as const,
        id: f.id,
        amount: Number(f.amount),
        status: f.status,
        user: f.user ? `${f.user.first_name} ${f.user.last_name}` : 'N/A',
        createdAt: f.created_at
      }))
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);

    return activity;
  },

  async getTopPerformers() {
    const topInvestors = await prisma.investments.groupBy({
      by: ['user_id'],
      where: { status: 'ACTIVE' },
      _sum: { current_value: true },
      orderBy: { _sum: { current_value: 'desc' } },
      take: 5
    });

    const userIds = topInvestors.map(i => i.user_id);
    const users = await prisma.users.findMany({
      where: { id: { in: userIds } },
      select: { id: true, first_name: true, last_name: true, email: true, user_level: true }
    });

    return topInvestors.map(inv => {
      const user = users.find(u => u.id === inv.user_id);
      return {
        userId: inv.user_id,
        name: user ? `${user.first_name} ${user.last_name}` : 'N/A',
        email: user?.email,
        level: user?.user_level,
        totalInvested: Number(inv._sum.current_value || 0)
      };
    });
  }
};
