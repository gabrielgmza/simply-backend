import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const exportService = {
  async exportEmployeesToCSV() {
    const employees = await prisma.employees.findMany({
      orderBy: { created_at: 'desc' }
    });

    const headers = ['ID', 'Email', 'Nombre', 'Apellido', 'Rol', 'Estado', 'Fecha Creación'];
    const rows = employees.map(e => [
      e.id,
      e.email,
      e.first_name,
      e.last_name,
      e.role,
      e.status,
      e.created_at.toISOString()
    ]);

    return { headers, rows };
  },

  async exportTicketsToCSV() {
    const tickets = await prisma.tickets.findMany({
      include: {
        created_by: { select: { email: true } },
        assigned_to: { select: { email: true } }
      },
      orderBy: { created_at: 'desc' }
    });

    const headers = ['ID', 'Título', 'Categoría', 'Prioridad', 'Estado', 'Creado Por', 'Asignado A', 'Fecha'];
    const rows = tickets.map(t => [
      t.id,
      t.title,
      t.category,
      t.priority,
      t.status,
      t.created_by.email,
      t.assigned_to?.email || 'Sin asignar',
      t.created_at.toISOString()
    ]);

    return { headers, rows };
  },

  async exportUsersToCSV() {
    const users = await prisma.users.findMany({
      orderBy: { created_at: 'desc' }
    });

    const headers = ['ID', 'Email', 'Teléfono', 'KYC Status', 'Fecha Registro'];
    const rows = users.map(u => [
      u.id,
      u.email,
      u.phone || '',
      u.kyc_status || 'pending',
      u.created_at.toISOString()
    ]);

    return { headers, rows };
  },

  formatToCSV(headers: string[], rows: any[][]) {
    const csvRows = [headers.join(',')];
    
    rows.forEach(row => {
      const escapedRow = row.map(cell => {
        const cellStr = String(cell || '');
        if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
          return `"${cellStr.replace(/"/g, '""')}"`;
        }
        return cellStr;
      });
      csvRows.push(escapedRow.join(','));
    });

    return csvRows.join('\n');
  }
};
