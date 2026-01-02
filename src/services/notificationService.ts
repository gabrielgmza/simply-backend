import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const notificationService = {
  async create(data: {
    employeeId: string;
    type: string;
    title: string;
    message: string;
    link?: string;
    metadata?: any;
  }) {
    const notification = await prisma.notifications.create({
      data: {
        employee_id: data.employeeId,
        type: data.type,
        title: data.title,
        message: data.message,
        link: data.link,
        metadata: data.metadata || {},
        is_read: false
      }
    });

    return notification;
  },

  async getByEmployee(employeeId: string, limit: number = 20) {
    const notifications = await prisma.notifications.findMany({
      where: { employee_id: employeeId },
      orderBy: { created_at: 'desc' },
      take: limit
    });

    return notifications;
  },

  async getUnreadCount(employeeId: string) {
    const count = await prisma.notifications.count({
      where: {
        employee_id: employeeId,
        is_read: false
      }
    });

    return count;
  },

  async markAsRead(id: string, employeeId: string) {
    const notification = await prisma.notifications.updateMany({
      where: {
        id,
        employee_id: employeeId
      },
      data: {
        is_read: true,
        read_at: new Date()
      }
    });

    return notification.count > 0;
  },

  async markAllAsRead(employeeId: string) {
    await prisma.notifications.updateMany({
      where: {
        employee_id: employeeId,
        is_read: false
      },
      data: {
        is_read: true,
        read_at: new Date()
      }
    });
  },

  async delete(id: string, employeeId: string) {
    await prisma.notifications.deleteMany({
      where: {
        id,
        employee_id: employeeId
      }
    });
  },

  // Helper para crear notificaciones automáticas
  async notifyTicketAssigned(ticketId: string, assignedToId: string, assignedBy: string) {
    const ticket = await prisma.tickets.findUnique({
      where: { id: ticketId },
      include: {
        created_by: {
          select: { first_name: true, last_name: true }
        }
      }
    });

    if (!ticket) return;

    await this.create({
      employeeId: assignedToId,
      type: 'TICKET_ASSIGNED',
      title: 'Nuevo ticket asignado',
      message: `Se te asignó el ticket: ${ticket.title}`,
      link: `/tickets/${ticketId}`,
      metadata: {
        ticketId,
        assignedBy,
        priority: ticket.priority
      }
    });
  },

  async notifyNewUser(employeeId: string, userId: string, userEmail: string) {
    await this.create({
      employeeId,
      type: 'NEW_USER',
      title: 'Nuevo usuario registrado',
      message: `${userEmail} se registró en la plataforma`,
      link: `/users/${userId}`,
      metadata: { userId, userEmail }
    });
  },

  async notifyTicketComment(ticketId: string, commentBy: string, ticketTitle: string, assignedToId?: string) {
    if (!assignedToId) return;

    await this.create({
      employeeId: assignedToId,
      type: 'TICKET_COMMENT',
      title: 'Nuevo comentario en ticket',
      message: `${commentBy} comentó en: ${ticketTitle}`,
      link: `/tickets/${ticketId}`,
      metadata: { ticketId, commentBy }
    });
  }
};
