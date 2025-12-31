import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(helmet());
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      success: true,
      status: 'ok',
      message: 'Simply API is running',
      timestamp: new Date().toISOString(),
      database: 'connected',
      version: '2.1.0-apprunner'
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
// BACKOFFICE AUTH
// ==========================================
app.post('/api/backoffice/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email y contraseña son requeridos'
      });
    }

    const ADMIN_EMAIL = 'admin@simply.com';
    const ADMIN_PASSWORD = 'Admin123!';

    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      const token = 'jwt-token-' + Date.now();

      return res.json({
        success: true,
        token,
        user: {
          id: '1',
          email: ADMIN_EMAIL,
          first_name: 'Super',
          last_name: 'Admin',
          role: 'SUPER_ADMIN',
          permissions: ['*']
        }
      });
    }

    res.status(401).json({
      success: false,
      error: 'Email o contraseña incorrectos'
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor'
    });
  }
});

// ==========================================
// BACKOFFICE USERS
// ==========================================
app.get('/api/backoffice/users', async (req, res) => {
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
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener usuarios'
    });
  }
});

// ==========================================
// BACKOFFICE LEADS
// ==========================================
app.get('/api/backoffice/leads', async (req, res) => {
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
    const where: any = {};
    if (search) {
      where.OR = [
        { nombre: { contains: search as string, mode: 'insensitive' } },
        { apellido: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
        { telefono: { contains: search as string, mode: 'insensitive' } }
      ];
    }

    // Obtener leads con paginación
    const [leads, total] = await Promise.all([
      prisma.leads.findMany({
        where,
        orderBy: { [sortBy as string]: order === 'asc' ? 'asc' : 'desc' },
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
          status: true,
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
  } catch (error: any) {
    console.error('Get leads error:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener leads'
    });
  }
});

app.get('/api/backoffice/leads/:id', async (req, res) => {
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
  } catch (error: any) {
    console.error('Get lead error:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener lead'
    });
  }
});

app.get('/api/backoffice/leads/export', async (req, res) => {
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
      'Estado',
      'Fecha Registro'
    ];

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
    res.send('\uFEFF' + csv); // BOM para Excel
  } catch (error: any) {
    console.error('Export leads error:', error);
    res.status(500).json({
      success: false,
      error: 'Error al exportar leads'
    });
  }
});

// ==========================================
// LANDING - LEADS
// ==========================================
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

    console.log('✅ Lead created:', lead.id, email);

    res.status(201).json({
      success: true,
      message: '¡Gracias por registrarte! Te contactaremos pronto.',
      data: {
        id: lead.id,
        email: lead.email
      }
    });
  } catch (error: any) {
    console.error('Create lead error:', error);
    
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

// ==========================================
// LANDING - CONTACT
// ==========================================
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

    console.log('✅ Contact message created:', contact.id);

    res.status(201).json({
      success: true,
      message: '¡Mensaje enviado! Te responderemos pronto.',
      data: { id: contact.id }
    });
  } catch (error: any) {
    console.error('Create contact error:', error);
    res.status(500).json({
      success: false,
      error: 'Error al enviar el mensaje'
    });
  }
});

// ==========================================
// LANDING - CALCULATOR
// ==========================================
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

    console.log('✅ Simulation created:', simulation.id);

    res.status(201).json({
      success: true,
      data: { id: simulation.id }
    });
  } catch (error: any) {
    console.error('Create simulation error:', error);
    res.status(500).json({
      success: false,
      error: 'Error al guardar simulación'
    });
  }
});

// ==========================================
// LANDING - NEWSLETTER
// ==========================================
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

    console.log('✅ Newsletter subscriber created:', subscriber.id);

    res.status(201).json({
      success: true,
      message: '¡Suscripción exitosa!',
      data: { id: subscriber.id }
    });
  } catch (error: any) {
    console.error('Newsletter subscription error:', error);
    
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
// 404 HANDLER
// ==========================================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Ruta no encontrada',
    path: req.path,
    method: req.method,
    availableRoutes: [
      'GET /health',
      'POST /api/backoffice/auth/login',
      'GET /api/backoffice/users',
      'GET /api/backoffice/leads',
      'GET /api/backoffice/leads/:id',
      'GET /api/backoffice/leads/export',
      'POST /api/landing/leads',
      'POST /api/landing/contact',
      'POST /api/landing/calculator',
      'POST /api/landing/newsletter'
    ]
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
  console.log(`\n🚀 Simply API started`);
  console.log(`📊 Port: ${port}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'production'}`);
  
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log(`✅ Database: Connected`);
  } catch (error) {
    console.error(`❌ Database: Connection failed`);
  }
  
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
