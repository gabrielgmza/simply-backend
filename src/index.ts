import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, requirePermission, AuthRequest } from './middleware/auth';
import { authService } from './services/authService';
import { employeeService } from './services/employeeService';

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 8080;

// Middleware global
app.use(helmet());
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// ==========================================
// HEALTH CHECK
// ==========================================
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      success: true,
      status: 'ok',
      message: 'Simply API is running',
      timestamp: new Date().toISOString(),
      database: 'connected',
      version: '2.2.0-auth-rbac'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      status: 'error',
      database: 'disconnected',
      error: error.message
    });
  }
});

// ==========================================
// AUTH ENDPOINTS
// ==========================================

// Login
app.post('/api/backoffice/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email y contraseña son requeridos'
      });
    }

    const result = await authService.login(email, password);

    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(401).json({
      success: false,
      error: error.message || 'Error en login'
    });
  }
});

// Get current user
app.get('/api/backoffice/auth/me', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const employee = await employeeService.getById(req.employee!.id);
    
    res.json({
      success: true,
      data: employee
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Logout
app.post('/api/backoffice/auth/logout', authMiddleware, async (req: AuthRequest, res) => {
  try {
    res.json({
      success: true,
      message: 'Sesión cerrada exitosamente'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==========================================
// EMPLOYEES ENDPOINTS  
// ==========================================

// Get all employees
app.get('/api/backoffice/employees', authMiddleware, requirePermission('employees:read'), async (req: AuthRequest, res) => {
  try {
    const { page, limit, search, role, status } = req.query;
    
    const result = await employeeService.getAll({
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      search: search as string,
      role: role as string,
      status: status as string
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    console.error('Get employees error:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener empleados'
    });
  }
});

// Get employee by ID
app.get('/api/backoffice/employees/:id', authMiddleware, requirePermission('employees:read'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const employee = await employeeService.getById(id);

    res.json({
      success: true,
      data: employee
    });
  } catch (error: any) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

// Create employee
app.post('/api/backoffice/employees', authMiddleware, requirePermission('employees:create'), async (req: AuthRequest, res) => {
  try {
    const { email, password, firstName, lastName, role } = req.body;

    if (!email || !password || !firstName || !lastName || !role) {
      return res.status(400).json({
        success: false,
        error: 'Todos los campos son requeridos'
      });
    }

    const employee = await employeeService.create({
      email,
      password,
      firstName,
      lastName,
      role
    });

    res.status(201).json({
      success: true,
      data: employee,
      message: 'Empleado creado exitosamente'
    });
  } catch (error: any) {
    console.error('Create employee error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Update employee
app.put('/api/backoffice/employees/:id', authMiddleware, requirePermission('employees:update'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, role, status, avatarUrl, preferences } = req.body;

    const employee = await employeeService.update(id, {
      firstName,
      lastName,
      role,
      status,
      avatarUrl,
      preferences
    });

    res.json({
      success: true,
      data: employee,
      message: 'Empleado actualizado exitosamente'
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Update password
app.patch('/api/backoffice/employees/:id/password', authMiddleware, requirePermission('employees:update'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'La contraseña debe tener al menos 8 caracteres'
      });
    }

    await employeeService.updatePassword(id, newPassword);

    res.json({
      success: true,
      message: 'Contraseña actualizada exitosamente'
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Delete (soft) employee
app.delete('/api/backoffice/employees/:id', authMiddleware, requirePermission('employees:delete'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    if (id === req.employee!.id) {
      return res.status(400).json({
        success: false,
        error: 'No puedes desactivar tu propia cuenta'
      });
    }

    await employeeService.delete(id);

    res.json({
      success: true,
      message: 'Empleado desactivado exitosamente'
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Get stats
app.get('/api/backoffice/employees/stats/overview', authMiddleware, requirePermission('employees:read'), async (req: AuthRequest, res) => {
  try {
    const stats = await employeeService.getStats();

    res.json({
      success: true,
      data: stats
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Error al obtener estadísticas'
    });
  }
});

// ==========================================
// USERS, LEADS, LANDING (Sin cambios)
// ==========================================

app.get('/api/backoffice/users', authMiddleware, requirePermission('users:read'), async (req, res) => {
  try {
    const users = await prisma.users.findMany({
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        dni: true,
        phone: true,
        user_status: true,
        kyc_status: true,
        user_level: true,
        created_at: true
      },
      take: 100,
      orderBy: { created_at: 'desc' }
    });

    res.json({
      success: true,
      data: users,
      total: users.length
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Error al obtener usuarios'
    });
  }
});

app.get('/api/backoffice/leads', authMiddleware, requirePermission('leads:read'), async (req, res) => {
  try {
    const { page = '1', limit = '20', search = '', sortBy = 'created_at', order = 'desc' } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};
    if (search) {
      where.OR = [
        { nombre: { contains: search as string, mode: 'insensitive' } },
        { apellido: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
        { telefono: { contains: search as string, mode: 'insensitive' } }
      ];
    }

    const [leads, total] = await Promise.all([
      prisma.leads.findMany({
        where,
        orderBy: { [sortBy as string]: order === 'asc' ? 'asc' : 'desc' },
        skip,
        take: limitNum
      }),
      prisma.leads.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        leads,
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Error al obtener leads'
    });
  }
});

app.get('/api/backoffice/leads/:id', authMiddleware, requirePermission('leads:read'), async (req, res) => {
  try {
    const { id } = req.params;
    const lead = await prisma.leads.findUnique({ where: { id } });

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
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Error al obtener lead'
    });
  }
});

app.get('/api/backoffice/leads/export/csv', authMiddleware, requirePermission('leads:export'), async (req, res) => {
  try {
    const leads = await prisma.leads.findMany({
      orderBy: { created_at: 'desc' }
    });

    const headers = ['ID', 'Nombre', 'Apellido', 'Email', 'Teléfono', 'Source', 'UTM Source', 'UTM Medium', 'UTM Campaign', 'Estado', 'Fecha Registro'];
    const rows = leads.map((lead: any) => [
      lead.id,
      lead.nombre,
      lead.apellido,
      lead.email,
      lead.telefono || '',
      lead.source,
      lead.utm_source || '',
      lead.utm_medium || '',
      lead.utm_campaign || '',
      lead.status || 'new',
      new Date(lead.created_at).toISOString()
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=leads-${Date.now()}.csv`);
    res.send('\uFEFF' + csv);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Error al exportar leads'
    });
  }
});

app.post('/api/landing/leads', async (req, res) => {
  try {
    const { nombre, apellido, email, telefono, terminos_aceptados, source, utm_source, utm_medium, utm_campaign } = req.body;

    if (!nombre || !apellido || !email) {
      return res.status(400).json({
        success: false,
        error: 'Nombre, apellido y email son requeridos'
      });
    }

    const lead = await prisma.leads.create({
      data: {
        nombre,
        apellido,
        email,
        telefono: telefono || null,
        terminos_aceptados: terminos_aceptados || true,
        source: source || 'landing',
        utm_source: utm_source || null,
        utm_medium: utm_medium || null,
        utm_campaign: utm_campaign || null,
        status: 'new'
      }
    });

    res.status(201).json({
      success: true,
      message: '¡Gracias por registrarte! Te contactaremos pronto.',
      data: { id: lead.id, email: lead.email }
    });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        error: 'Este email ya está registrado'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Error al guardar el registro'
    });
  }
});

app.post('/api/landing/contact', async (req, res) => {
  try {
    const { nombre, email, asunto, mensaje } = req.body;

    if (!nombre || !email || !mensaje) {
      return res.status(400).json({
        success: false,
        error: 'Nombre, email y mensaje son requeridos'
      });
    }

    const contact = await prisma.contact_messages.create({
      data: {
        nombre,
        email,
        asunto: asunto || 'Consulta desde landing',
        mensaje,
        status: 'new'
      }
    });

    res.status(201).json({
      success: true,
      message: '¡Mensaje enviado! Te responderemos pronto.',
      data: { id: contact.id }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Error al enviar el mensaje'
    });
  }
});

app.post('/api/landing/calculator', async (req, res) => {
  try {
    const { monto_inversion, plazo_meses, nivel_cliente, rendimiento_total, monto_final, financiacion_disponible } = req.body;

    const simulation = await prisma.calculator_simulations.create({
      data: {
        monto_inversion,
        plazo_meses,
        nivel_cliente: nivel_cliente || 'plata',
        rendimiento_total,
        monto_final,
        financiacion_disponible
      }
    });

    res.status(201).json({
      success: true,
      data: { id: simulation.id }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Error al guardar simulación'
    });
  }
});

app.post('/api/landing/newsletter', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email requerido'
      });
    }

    const subscriber = await prisma.newsletter_subscribers.create({
      data: {
        email,
        status: 'active',
        source: 'landing'
      }
    });

    res.status(201).json({
      success: true,
      message: '¡Suscripción exitosa!',
      data: { id: subscriber.id }
    });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        error: 'Este email ya está suscrito'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Error al suscribirse'
    });
  }
});

// ==========================================
// TICKETS ENDPOINTS
// ==========================================
import { ticketService } from './services/ticketService';

// Get all tickets
app.get('/api/backoffice/tickets', authMiddleware, requirePermission('tickets:read'), async (req: AuthRequest, res) => {
  try {
    const { page, limit, status, priority, category, assignedTo, createdBy } = req.query;

    const result = await ticketService.getAll({
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      status: status as string,
      priority: priority as string,
      category: category as string,
      assignedTo: assignedTo as string,
      createdBy: createdBy as string
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Error al obtener tickets'
    });
  }
});

// Get ticket by ID
app.get('/api/backoffice/tickets/:id', authMiddleware, requirePermission('tickets:read'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const ticket = await ticketService.getById(id);

    res.json({
      success: true,
      data: ticket
    });
  } catch (error: any) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

// Create ticket
app.post('/api/backoffice/tickets', authMiddleware, requirePermission('tickets:create'), async (req: AuthRequest, res) => {
  try {
    const { title, description, category, priority, assignedToId, tags } = req.body;

    if (!title || !description || !category || !priority) {
      return res.status(400).json({
        success: false,
        error: 'Título, descripción, categoría y prioridad son requeridos'
      });
    }

    const ticket = await ticketService.create({
      title,
      description,
      category,
      priority,
      createdById: req.employee!.id,
      assignedToId,
      tags
    });

    res.status(201).json({
      success: true,
      data: ticket,
      message: 'Ticket creado exitosamente'
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Update ticket
app.put('/api/backoffice/tickets/:id', authMiddleware, requirePermission('tickets:update'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { title, description, category, priority, status, tags } = req.body;

    const ticket = await ticketService.update(id, {
      title,
      description,
      category,
      priority,
      status,
      tags
    });

    res.json({
      success: true,
      data: ticket,
      message: 'Ticket actualizado exitosamente'
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Assign ticket
app.patch('/api/backoffice/tickets/:id/assign', authMiddleware, requirePermission('tickets:update'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { assignedToId } = req.body;

    if (!assignedToId) {
      return res.status(400).json({
        success: false,
        error: 'assignedToId es requerido'
      });
    }

    const ticket = await ticketService.assign(id, assignedToId);

    res.json({
      success: true,
      data: ticket,
      message: 'Ticket asignado exitosamente'
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Update ticket status
app.patch('/api/backoffice/tickets/:id/status', authMiddleware, requirePermission('tickets:update'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        error: 'status es requerido'
      });
    }

    const ticket = await ticketService.updateStatus(id, status);

    res.json({
      success: true,
      data: ticket,
      message: 'Estado actualizado exitosamente'
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Add comment to ticket
app.post('/api/backoffice/tickets/:id/comments', authMiddleware, requirePermission('tickets:create'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { comment, isInternal } = req.body;

    if (!comment) {
      return res.status(400).json({
        success: false,
        error: 'comment es requerido'
      });
    }

    const newComment = await ticketService.addComment({
      ticketId: id,
      employeeId: req.employee!.id,
      comment,
      isInternal
    });

    res.status(201).json({
      success: true,
      data: newComment,
      message: 'Comentario agregado exitosamente'
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Get ticket stats
app.get('/api/backoffice/tickets/stats/overview', authMiddleware, requirePermission('tickets:read'), async (req: AuthRequest, res) => {
  try {
    const stats = await ticketService.getStats();

    res.json({
      success: true,
      data: stats
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Error al obtener estadísticas'
    });
  }
});

// ==========================================
// ARIA AI ENDPOINTS
// ==========================================
import { ariaService } from './services/ariaService';

// Chat with Aria
app.post('/api/backoffice/aria/chat', authMiddleware, requirePermission('aria:use'), async (req: AuthRequest, res) => {
  try {
    const { message, conversationId } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'message es requerido'
      });
    }

    const result = await ariaService.chat({
      employeeId: req.employee!.id,
      message,
      conversationId
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    console.error('Aria chat error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error al procesar el mensaje'
    });
  }
});

// Get conversations
app.get('/api/backoffice/aria/conversations', authMiddleware, requirePermission('aria:use'), async (req: AuthRequest, res) => {
  try {
    const { limit } = req.query;
    const conversations = await ariaService.getConversations(
      req.employee!.id,
      limit ? parseInt(limit as string) : undefined
    );

    res.json({
      success: true,
      data: conversations
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Error al obtener conversaciones'
    });
  }
});

// Get conversation by ID
app.get('/api/backoffice/aria/conversations/:id', authMiddleware, requirePermission('aria:use'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const conversation = await ariaService.getConversation(id, req.employee!.id);

    res.json({
      success: true,
      data: conversation
    });
  } catch (error: any) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

// Delete conversation
app.delete('/api/backoffice/aria/conversations/:id', authMiddleware, requirePermission('aria:use'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    await ariaService.deleteConversation(id, req.employee!.id);

    res.json({
      success: true,
      message: 'Conversación eliminada exitosamente'
    });
  } catch (error: any) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

// Update conversation title
app.patch('/api/backoffice/aria/conversations/:id', authMiddleware, requirePermission('aria:use'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { title } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        error: 'title es requerido'
      });
    }

    await ariaService.updateTitle(id, req.employee!.id, title);

    res.json({
      success: true,
      message: 'Título actualizado exitosamente'
    });
  } catch (error: any) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

// ==========================================
// 404 HANDLER
// ==========================================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Ruta no encontrada',
    path: req.path,
    method: req.method
  });
});

// ==========================================
// ERROR HANDLER
// ==========================================
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Error interno del servidor',
    message: err.message
  });
});

// ==========================================
// START SERVER
// ==========================================
const port = parseInt(process.env.PORT || '8080', 10);

app.listen(port, '0.0.0.0', async () => {
  console.log(`\n🚀 Simply API v2.2.0 started`);
  console.log(`📊 Port: ${port}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'production'}`);
  
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log(`✅ Database: Connected`);
  } catch (error) {
    console.error(`❌ Database: Connection failed`);
  }
  
  console.log(`\n✨ Features: Auth + RBAC + Employees + Tickets + Aria AI`);
  console.log(`\n`);
});

// ==========================================
// GRACEFUL SHUTDOWN
// ==========================================
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing server...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing server...');
  await prisma.$disconnect();
  process.exit(0);
});
