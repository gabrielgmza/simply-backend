import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const dashboardService = {
  async getGeneralStats() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Stats principales
    const [
      totalUsers,
      newUsersToday,
      totalLeads,
      newLeadsToday,
      totalEmployees,
      activeEmployees,
      totalTickets,
      openTickets,
      resolvedTickets,
      usersLastMonth,
      leadsLastMonth
    ] = await Promise.all([
      prisma.users.count(),
      prisma.users.count({ where: { created_at: { gte: yesterday } } }),
      prisma.leads.count(),
      prisma.leads.count({ where: { created_at: { gte: yesterday } } }),
      prisma.employees.count(),
      prisma.employees.count({ where: { status: 'ACTIVE' } }),
      prisma.tickets.count(),
      prisma.tickets.count({ where: { status: 'OPEN' } }),
      prisma.tickets.count({ where: { status: 'RESOLVED' } }),
      prisma.users.count({ where: { created_at: { gte: thirtyDaysAgo } } }),
      prisma.leads.count({ where: { created_at: { gte: thirtyDaysAgo } } })
    ]);

    // Calcular cambios porcentuales (simplificado)
    const userGrowth = totalUsers > 0 ? ((usersLastMonth / totalUsers) * 100) : 0;
    const leadGrowth = totalLeads > 0 ? ((leadsLastMonth / totalLeads) * 100) : 0;

    return {
      users: {
        total: totalUsers,
        newToday: newUsersToday,
        growth: Math.round(userGrowth)
      },
      leads: {
        total: totalLeads,
        newToday: newLeadsToday,
        growth: Math.round(leadGrowth),
        conversionRate: totalUsers > 0 ? Math.round((totalUsers / totalLeads) * 100) : 0
      },
      employees: {
        total: totalEmployees,
        active: activeEmployees
      },
      tickets: {
        total: totalTickets,
        open: openTickets,
        resolved: resolvedTickets,
        resolutionRate: totalTickets > 0 ? Math.round((resolvedTickets / totalTickets) * 100) : 0
      }
    };
  },

  async getGrowthData(days: number = 30) {
    const now = new Date();
    const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    // Obtener datos agrupados por día
    const users = await prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
      SELECT DATE(created_at) as date, COUNT(*)::bigint as count
      FROM users
      WHERE created_at >= ${startDate}
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `;

    const leads = await prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
      SELECT DATE(created_at) as date, COUNT(*)::bigint as count
      FROM leads
      WHERE created_at >= ${startDate}
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `;

    // Formatear datos para el gráfico
    const dateMap = new Map();
    
    users.forEach(u => {
      const dateKey = u.date.toISOString().split('T')[0];
      dateMap.set(dateKey, { date: dateKey, users: Number(u.count), leads: 0 });
    });

    leads.forEach(l => {
      const dateKey = l.date.toISOString().split('T')[0];
      const existing = dateMap.get(dateKey) || { date: dateKey, users: 0, leads: 0 };
      existing.leads = Number(l.count);
      dateMap.set(dateKey, existing);
    });

    return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  },

  async getRecentActivity(limit: number = 10) {
    const [recentUsers, recentLeads, recentTickets] = await Promise.all([
      prisma.users.findMany({
        take: 3,
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          email: true,
          created_at: true
        }
      }),
      prisma.leads.findMany({
        take: 3,
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          email: true,
          nombre: true,
          created_at: true
        }
      }),
      prisma.tickets.findMany({
        take: 4,
        orderBy: { created_at: 'desc' },
        include: {
          created_by: {
            select: {
              first_name: true,
              last_name: true
            }
          }
        }
      })
    ]);

    const activity: Array<{
      type: string;
      description: string;
      timestamp: Date;
      id: string;
      creator?: string;
    }> = [];

    recentUsers.forEach(u => {
      activity.push({
        type: 'user',
        description: `Nuevo usuario: ${u.email}`,
        timestamp: u.created_at,
        id: u.id
      });
    });

    recentLeads.forEach(l => {
      activity.push({
        type: 'lead',
        description: `Nuevo lead: ${l.nombre || l.email}`,
        timestamp: l.created_at,
        id: l.id
      });
    });

    recentTickets.forEach(t => {
      activity.push({
        type: 'ticket',
        description: `Ticket creado: ${t.title}`,
        timestamp: t.created_at,
        id: t.id,
        creator: `${t.created_by.first_name} ${t.created_by.last_name}`
      });
    });

    return activity.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    ).slice(0, limit);
  },

  async getTopPerformers() {
    // Obtener empleados con sus tickets
    const employees = await prisma.employees.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        email: true,
        role: true,
        assigned_tickets: {
          select: { id: true }
        },
        tickets: {
          select: { id: true }
        }
      },
      take: 10
    });

    // Mapear y ordenar manualmente
    const performersWithCount = employees.map(e => ({
      id: e.id,
      name: `${e.first_name} ${e.last_name}`,
      email: e.email,
      role: e.role,
      ticketsAssigned: e.assigned_tickets.length,
      ticketsCreated: e.tickets.length,
      total: e.assigned_tickets.length + e.tickets.length
    }));

    // Ordenar por total descendente y tomar top 5
    return performersWithCount
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  },

  async getLeadConversion() {
    const [totalLeads, convertedLeads] = await Promise.all([
      prisma.leads.count(),
      prisma.users.count()
    ]);

    const stages = [
      { name: 'Leads', value: totalLeads },
      { name: 'Usuarios', value: convertedLeads }
    ];

    return {
      stages,
      conversionRate: totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0
    };
  }
};
