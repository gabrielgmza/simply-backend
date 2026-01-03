import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const ticketService = {
  async getAll(filters: {
    page?: number;
    limit?: number;
    status?: string;
    priority?: string;
    category?: string;
    assignedTo?: string;
    createdBy?: string;
  }) {
    const { page = 1, limit = 20, status, priority, category, assignedTo, createdBy } = filters;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (category) where.category = category;
    if (assignedTo) where.assigned_to_id = assignedTo;
    if (createdBy) where.created_by_id = createdBy;

    const [tickets, total] = await Promise.all([
      prisma.tickets.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          created_by: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true
            }
          },
          assigned_to: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true
            }
          },
          comments: {
            orderBy: { created_at: 'desc' },
            take: 3,
            include: {
              employee: {
                select: {
                  id: true,
                  first_name: true,
                  last_name: true
                }
              }
            }
          }
        }
      }),
      prisma.tickets.count({ where })
    ]);

    return {
      tickets,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  },

  async getById(id: string) {
    const ticket = await prisma.tickets.findUnique({
      where: { id },
      include: {
        created_by: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
            role: true
          }
        },
        assigned_to: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
            role: true
          }
        },
        comments: {
          orderBy: { created_at: 'asc' },
          include: {
            employee: {
              select: {
                id: true,
                first_name: true,
                last_name: true,
                email: true
              }
            }
          }
        }
      }
    });

    if (!ticket) {
      throw new Error('Ticket no encontrado');
    }

    return ticket;
  },

  async create(data: {
    title: string;
    description: string;
    category: string;
    priority: string;
    createdById: string;
    assignedToId?: string;
    tags?: string[];
  }) {
    const ticket = await prisma.tickets.create({
      data: {
        title: data.title,
        description: data.description,
        category: data.category as any,
        priority: data.priority as any,
        created_by_id: data.createdById,
        assigned_to_id: data.assignedToId || null,
        tags: data.tags || [],
        status: 'OPEN'
      },
      include: {
        created_by: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true
          }
        }
      }
    });

    return ticket;
  },

  async update(id: string, data: {
    title?: string;
    description?: string;
    category?: string;
    priority?: string;
    status?: string;
    tags?: string[];
  }) {
    const ticket = await prisma.tickets.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        category: data.category as any,
        priority: data.priority as any,
        status: data.status as any,
        tags: data.tags,
        updated_at: new Date(),
        resolved_at: data.status === 'RESOLVED' ? new Date() : undefined
      }
    });

    return ticket;
  },

  async assign(id: string, assignedToId: string) {
    const ticket = await prisma.tickets.update({
      where: { id },
      data: {
        assigned_to_id: assignedToId,
        status: 'IN_PROGRESS'
      }
    });

    return ticket;
  },

  async updateStatus(id: string, status: string) {
    const ticket = await prisma.tickets.update({
      where: { id },
      data: {
        status: status as any,
        resolved_at: status === 'RESOLVED' || status === 'CLOSED' ? new Date() : null
      }
    });

    return ticket;
  },

  async addComment(data: {
    ticketId: string;
    employeeId: string;
    comment: string;
    isInternal?: boolean;
  }) {
    const comment = await prisma.ticket_comments.create({
      data: {
        ticket_id: data.ticketId,
        employee_id: data.employeeId,
        comment: data.comment,
        is_internal: data.isInternal || false
      },
      include: {
        employee: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true
          }
        }
      }
    });

    return comment;
  },

  async getStats() {
    const [total, open, inProgress, resolved] = await Promise.all([
      prisma.tickets.count(),
      prisma.tickets.count({ where: { status: 'OPEN' } }),
      prisma.tickets.count({ where: { status: 'IN_PROGRESS' } }),
      prisma.tickets.count({ where: { status: 'RESOLVED' } })
    ]);

    const byPriority = await prisma.tickets.groupBy({
      by: ['priority'],
      _count: true
    });

    const byCategory = await prisma.tickets.groupBy({
      by: ['category'],
      _count: true
    });

    return {
      total,
      open,
      inProgress,
      resolved,
      byPriority,
      byCategory
    };
  }
};
