// ========================================
// ENDPOINTS DE LEADS
// Agregar esto a: src/routes/backoffice.ts
// ========================================

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Middleware de autenticación (debe estar definido en tu archivo)
// import { authMiddleware } from '../middleware/auth';

// GET /api/backoffice/leads - Listar leads con paginación y búsqueda
router.get('/leads', authMiddleware, async (req, res) => {
  try {
    const { 
      page = '1', 
      limit = '20', 
      search = '', 
      sortBy = 'created_at', 
      order = 'desc' 
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Construir filtro de búsqueda
    const where = search
      ? {
          OR: [
            { nombre: { contains: search as string, mode: 'insensitive' as any } },
            { apellido: { contains: search as string, mode: 'insensitive' as any } },
            { email: { contains: search as string, mode: 'insensitive' as any } },
            { telefono: { contains: search as string, mode: 'insensitive' as any } }
          ]
        }
      : {};

    // Obtener leads con paginación
    const [leads, total] = await Promise.all([
      prisma.leads.findMany({
        where,
        orderBy: {
          [sortBy as string]: order === 'asc' ? 'asc' : 'desc'
        },
        skip,
        take: limitNum,
        select: {
          id: true,
          nombre: true,
          apellido: true,
          email: true,
          telefono: true,
          terminos_aceptados: true,
          source: true,
          utm_source: true,
          utm_medium: true,
          utm_campaign: true,
          created_at: true,
          updated_at: true
        }
      }),
      prisma.leads.count({ where })
    ]);

    const totalPages = Math.ceil(total / limitNum);

    res.json({
      success: true,
      data: {
        leads,
        total,
        page: pageNum,
        totalPages
      }
    });
  } catch (error) {
    console.error('Error fetching leads:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener leads'
    });
  }
});

// GET /api/backoffice/leads/:id - Obtener lead específico
router.get('/leads/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const lead = await prisma.leads.findUnique({
      where: { id }
    });

    if (!lead) {
      return res.status(404).json({
        success: false,
        error: 'Lead no encontrado'
      });
    }

    res.json({
      success: true,
      data: lead
    });
  } catch (error) {
    console.error('Error fetching lead:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener lead'
    });
  }
});

// GET /api/backoffice/leads/export - Exportar leads a CSV
router.get('/leads/export', authMiddleware, async (req, res) => {
  try {
    const leads = await prisma.leads.findMany({
      orderBy: { created_at: 'desc' }
    });

    // Crear CSV
    const headers = [
      'ID',
      'Nombre',
      'Apellido',
      'Email',
      'Teléfono',
      'Source',
      'UTM Source',
      'UTM Medium',
      'UTM Campaign',
      'Fecha Registro'
    ];

    const rows = leads.map(lead => [
      lead.id,
      lead.nombre,
      lead.apellido,
      lead.email,
      lead.telefono || '',
      lead.source,
      lead.utm_source || '',
      lead.utm_medium || '',
      lead.utm_campaign || '',
      new Date(lead.created_at).toISOString()
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=leads-${Date.now()}.csv`);
    res.send('\uFEFF' + csv); // BOM para Excel
  } catch (error) {
    console.error('Error exporting leads:', error);
    res.status(500).json({
      success: false,
      error: 'Error al exportar leads'
    });
  }
});

export default router;
