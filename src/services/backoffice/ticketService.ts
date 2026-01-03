import { PrismaClient } from '@prisma/client';
import { ariaService } from './ariaAgentService';
import { auditLogService } from './auditLogService';

const prisma = new PrismaClient();

// ============================================
// CONFIGURACIÓN
// ============================================

const TICKET_CONFIG = {
  // SLA en horas
  sla: {
    urgent: { firstResponse: 1, resolution: 4 },
    high: { firstResponse: 4, resolution: 24 },
    medium: { firstResponse: 8, resolution: 48 },
    low: { firstResponse: 24, resolution: 72 }
  },
  
  // Auto-respuesta con Aria
  aria: {
    enabled: true,
    minConfidenceAutoResolve: 0.85,
    minConfidenceSuggest: 0.60,
    categories: ['billing', 'account', 'technical', 'general']
  },
  
  // Keywords que escalan automáticamente
  escalationKeywords: {
    fraud: ['fraude', 'robo', 'estafa', 'hackeo', 'no autorizado', 'phishing'],
    compliance: ['denuncia', 'lavado', 'ilegal', 'uif', 'bcra'],
    urgent: ['urgente', 'emergencia', 'bloqueado', 'no puedo acceder']
  }
};

// ============================================
// TIPOS
// ============================================

interface CreateTicketInput {
  userId?: string;
  employeeId?: string;
  subject: string;
  description: string;
  category?: string;
  priority?: string;
  attachments?: any[];
}

interface TicketClassification {
  category: string;
  intent: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  urgencyScore: number;
  isAutoResolvable: boolean;
  suggestedResponse?: string;
  escalateTo?: string;
  confidence: number;
}

// ============================================
// TICKET SERVICE
// ============================================

export const ticketService = {
  // -------------------------------------------
  // CREAR TICKET
  // -------------------------------------------
  
  async createTicket(input: CreateTicketInput): Promise<any> {
    const { userId, employeeId, subject, description, category, priority, attachments } = input;
    
    // 1. Clasificar con Aria
    const classification = await this.classifyTicket(subject, description);
    
    // 2. Determinar prioridad final
    const finalPriority = priority || this.determinePriority(classification);
    
    // 3. Calcular SLAs
    const slaConfig = TICKET_CONFIG.sla[finalPriority as keyof typeof TICKET_CONFIG.sla];
    const now = new Date();
    
    // 4. Crear ticket
    const ticket = await prisma.support_tickets.create({
      data: {
        user_id: userId,
        employee_id: employeeId,
        subject,
        description,
        category: category || classification.category,
        priority: finalPriority,
        
        // AI classification
        ai_category: classification.category,
        ai_intent: classification.intent,
        ai_sentiment: classification.sentiment,
        ai_urgency_score: classification.urgencyScore,
        ai_auto_resolvable: classification.isAutoResolvable,
        ai_suggested_response: classification.suggestedResponse,
        
        // Asignación
        assigned_team: classification.escalateTo || this.getTeamForCategory(classification.category),
        
        // SLA
        first_response_due: new Date(now.getTime() + slaConfig.firstResponse * 60 * 60 * 1000),
        resolution_due: new Date(now.getTime() + slaConfig.resolution * 60 * 60 * 1000)
      },
      include: {
        users: { select: { id: true, email: true, first_name: true, last_name: true } }
      }
    });
    
    // 5. Si es auto-resolvable, responder automáticamente
    if (classification.isAutoResolvable && classification.suggestedResponse && TICKET_CONFIG.aria.enabled) {
      await this.autoRespond(ticket.id, classification.suggestedResponse, classification.confidence);
    }
    
    // 6. Si requiere escalación, notificar
    if (classification.escalateTo) {
      await this.escalateTicket(ticket.id, classification.escalateTo, 'Auto-escalado por keywords detectadas');
    }
    
    return ticket;
  },
  
  // -------------------------------------------
  // CLASIFICACIÓN CON ARIA
  // -------------------------------------------
  
  async classifyTicket(subject: string, description: string): Promise<TicketClassification> {
    const fullText = `${subject}\n${description}`.toLowerCase();
    
    // 1. Detectar keywords de escalación
    let escalateTo: string | undefined;
    
    for (const [team, keywords] of Object.entries(TICKET_CONFIG.escalationKeywords)) {
      if (keywords.some(kw => fullText.includes(kw))) {
        escalateTo = team === 'urgent' ? 'support_priority' : team;
        break;
      }
    }
    
    // 2. Detectar categoría
    const categoryPatterns: Record<string, string[]> = {
      billing: ['factura', 'cobro', 'pago', 'cuota', 'cargo', 'comision'],
      account: ['cuenta', 'clave', 'contraseña', 'login', 'acceso', 'datos'],
      technical: ['error', 'bug', 'falla', 'no funciona', 'problema'],
      investment: ['inversion', 'rendimiento', 'fci', 'retiro'],
      financing: ['financiacion', 'prestamo', 'cuotas', 'deuda']
    };
    
    let category = 'general';
    for (const [cat, patterns] of Object.entries(categoryPatterns)) {
      if (patterns.some(p => fullText.includes(p))) {
        category = cat;
        break;
      }
    }
    
    // 3. Detectar sentimiento básico
    const negativeWords = ['malo', 'horrible', 'pesimo', 'enojado', 'furioso', 'estafa'];
    const positiveWords = ['gracias', 'excelente', 'genial', 'bueno'];
    
    let sentiment: 'positive' | 'neutral' | 'negative' = 'neutral';
    if (negativeWords.some(w => fullText.includes(w))) {
      sentiment = 'negative';
    } else if (positiveWords.some(w => fullText.includes(w))) {
      sentiment = 'positive';
    }
    
    // 4. Calcular urgencia
    let urgencyScore = 0.5;
    if (escalateTo) urgencyScore = 0.9;
    if (sentiment === 'negative') urgencyScore += 0.2;
    if (fullText.includes('urgente')) urgencyScore = 0.95;
    urgencyScore = Math.min(urgencyScore, 1);
    
    // 5. Generar respuesta sugerida para casos simples
    const commonResponses: Record<string, { pattern: string[]; response: string; confidence: number }[]> = {
      account: [
        {
          pattern: ['cambiar clave', 'cambiar contraseña', 'olvidé mi clave'],
          response: 'Para cambiar tu contraseña, ve a Configuración > Seguridad > Cambiar contraseña. Si olvidaste tu clave, usa la opción "Olvidé mi contraseña" en el login.',
          confidence: 0.90
        },
        {
          pattern: ['no puedo entrar', 'no puedo acceder', 'bloqueada'],
          response: 'Si tu cuenta está bloqueada por intentos fallidos, espera 30 minutos e intenta nuevamente. Si el problema persiste, escríbenos y te ayudamos a recuperar el acceso.',
          confidence: 0.85
        }
      ],
      billing: [
        {
          pattern: ['cuando se debita', 'fecha de cobro'],
          response: 'Las cuotas se debitan automáticamente el día de vencimiento. Puedes ver el cronograma completo en la sección Financiación > Mis cuotas.',
          confidence: 0.88
        }
      ],
      investment: [
        {
          pattern: ['cuando cobra', 'rendimiento', 'cuando veo'],
          response: 'Los rendimientos se acreditan diariamente a las 21:00 hs en días hábiles. Los fines de semana y feriados se acumulan y se acreditan el próximo día hábil.',
          confidence: 0.92
        }
      ]
    };
    
    let suggestedResponse: string | undefined;
    let confidence = 0.5;
    let isAutoResolvable = false;
    
    const categoryResponses = commonResponses[category];
    if (categoryResponses) {
      for (const r of categoryResponses) {
        if (r.pattern.some(p => fullText.includes(p))) {
          suggestedResponse = r.response;
          confidence = r.confidence;
          isAutoResolvable = confidence >= TICKET_CONFIG.aria.minConfidenceAutoResolve;
          break;
        }
      }
    }
    
    return {
      category,
      intent: this.detectIntent(fullText),
      sentiment,
      urgencyScore,
      isAutoResolvable,
      suggestedResponse,
      escalateTo,
      confidence
    };
  },
  
  detectIntent(text: string): string {
    const intents: Record<string, string[]> = {
      'question': ['cómo', 'como', 'qué', 'que', 'cuándo', 'cuando', 'dónde', 'donde', 'por qué'],
      'complaint': ['queja', 'reclamo', 'mal servicio', 'no funciona'],
      'request': ['quiero', 'necesito', 'solicito', 'pido'],
      'information': ['información', 'info', 'saber', 'consulta']
    };
    
    for (const [intent, patterns] of Object.entries(intents)) {
      if (patterns.some(p => text.includes(p))) {
        return intent;
      }
    }
    
    return 'general';
  },
  
  determinePriority(classification: TicketClassification): string {
    if (classification.escalateTo === 'fraud') return 'urgent';
    if (classification.urgencyScore >= 0.9) return 'urgent';
    if (classification.urgencyScore >= 0.7) return 'high';
    if (classification.sentiment === 'negative') return 'high';
    return 'medium';
  },
  
  getTeamForCategory(category: string): string {
    const mapping: Record<string, string> = {
      billing: 'finance',
      account: 'support',
      technical: 'technical',
      investment: 'finance',
      financing: 'finance',
      fraud: 'fraud',
      compliance: 'compliance',
      general: 'support'
    };
    return mapping[category] || 'support';
  },
  
  // -------------------------------------------
  // AUTO-RESPUESTA
  // -------------------------------------------
  
  async autoRespond(ticketId: string, response: string, confidence: number) {
    // Crear mensaje de Aria
    await prisma.ticket_messages.create({
      data: {
        ticket_id: ticketId,
        sender_type: 'aria',
        content: response,
        aria_generated: true,
        aria_confidence: confidence
      }
    });
    
    // Actualizar ticket
    await prisma.support_tickets.update({
      where: { id: ticketId },
      data: {
        status: 'waiting_customer',
        first_responded_at: new Date()
      }
    });
  },
  
  // -------------------------------------------
  // ESCALACIÓN
  // -------------------------------------------
  
  async escalateTicket(ticketId: string, team: string, reason: string) {
    await prisma.support_tickets.update({
      where: { id: ticketId },
      data: {
        assigned_team: team,
        priority: 'high',
        status: 'in_progress'
      }
    });
    
    // Nota interna
    await prisma.ticket_messages.create({
      data: {
        ticket_id: ticketId,
        sender_type: 'system',
        content: `⚠️ Ticket escalado a ${team}. Razón: ${reason}`,
        is_internal: true
      }
    });
  },
  
  // -------------------------------------------
  // OPERACIONES CRUD
  // -------------------------------------------
  
  async getTickets(filters?: {
    status?: string;
    priority?: string;
    category?: string;
    assignedTeam?: string;
    assignedTo?: string;
    userId?: string;
    page?: number;
    limit?: number;
  }) {
    const { page = 1, limit = 20 } = filters || {};
    const skip = (page - 1) * limit;
    
    const where: any = {};
    if (filters?.status) where.status = filters.status;
    if (filters?.priority) where.priority = filters.priority;
    if (filters?.category) where.category = filters.category;
    if (filters?.assignedTeam) where.assigned_team = filters.assignedTeam;
    if (filters?.assignedTo) where.assigned_to = filters.assignedTo;
    if (filters?.userId) where.user_id = filters.userId;
    
    const [tickets, total] = await Promise.all([
      prisma.support_tickets.findMany({
        where,
        include: {
          users: { select: { id: true, email: true, first_name: true, last_name: true } },
          assigned_employees: { select: { id: true, email: true, first_name: true, last_name: true } },
          _count: { select: { messages: true } }
        },
        orderBy: [
          { priority: 'desc' },
          { created_at: 'desc' }
        ],
        skip,
        take: limit
      }),
      prisma.support_tickets.count({ where })
    ]);
    
    return { tickets, total, page, totalPages: Math.ceil(total / limit) };
  },
  
  async getTicketById(ticketId: string) {
    return prisma.support_tickets.findUnique({
      where: { id: ticketId },
      include: {
        users: { select: { id: true, email: true, first_name: true, last_name: true, phone: true } },
        creator_employees: { select: { id: true, email: true, first_name: true, last_name: true } },
        assigned_employees: { select: { id: true, email: true, first_name: true, last_name: true } },
        messages: {
          orderBy: { created_at: 'asc' },
          include: {
            // No hay relación directa, pero podemos expandir si es necesario
          }
        }
      }
    });
  },
  
  async addMessage(ticketId: string, data: {
    senderId: string;
    senderType: 'user' | 'employee';
    content: string;
    isInternal?: boolean;
    attachments?: any[];
  }) {
    const message = await prisma.ticket_messages.create({
      data: {
        ticket_id: ticketId,
        sender_type: data.senderType,
        sender_id: data.senderId,
        content: data.content,
        is_internal: data.isInternal || false,
        attachments: data.attachments
      }
    });
    
    // Actualizar first_response_at si es la primera respuesta de un empleado
    const ticket = await prisma.support_tickets.findUnique({
      where: { id: ticketId }
    });
    
    if (ticket && !ticket.first_responded_at && data.senderType === 'employee') {
      await prisma.support_tickets.update({
        where: { id: ticketId },
        data: {
          first_responded_at: new Date(),
          status: 'in_progress'
        }
      });
    }
    
    return message;
  },
  
  async updateTicket(ticketId: string, data: {
    status?: string;
    priority?: string;
    assignedTo?: string;
    assignedTeam?: string;
  }, employeeId: string) {
    const oldTicket = await prisma.support_tickets.findUnique({
      where: { id: ticketId }
    });
    
    const updates: any = { ...data };
    
    if (data.status === 'resolved') {
      updates.resolved_at = new Date();
    }
    
    const ticket = await prisma.support_tickets.update({
      where: { id: ticketId },
      data: updates
    });
    
    // Audit log
    await auditLogService.log({
      actorType: 'employee',
      actorId: employeeId,
      action: 'ticket_updated',
      resource: 'tickets',
      resourceId: ticketId,
      description: `Ticket ${ticketId} actualizado`,
      oldData: oldTicket,
      newData: updates
    });
    
    return ticket;
  },
  
  async closeTicket(ticketId: string, employeeId: string, resolution?: string) {
    const ticket = await prisma.support_tickets.update({
      where: { id: ticketId },
      data: {
        status: 'closed',
        resolved_at: new Date()
      }
    });
    
    if (resolution) {
      await prisma.ticket_messages.create({
        data: {
          ticket_id: ticketId,
          sender_type: 'employee',
          sender_id: employeeId,
          content: `Ticket cerrado. Resolución: ${resolution}`,
          is_internal: true
        }
      });
    }
    
    return ticket;
  },
  
  // -------------------------------------------
  // ARIA INTEGRATION
  // -------------------------------------------
  
  async letAriaRespond(ticketId: string, employeeId: string): Promise<{
    response: string;
    confidence: number;
    autoSent: boolean;
  }> {
    const ticket = await this.getTicketById(ticketId);
    if (!ticket) throw new Error('Ticket no encontrado');
    
    // Crear sesión de Aria
    const sessionId = await ariaService.createSession(employeeId);
    
    // Construir contexto
    const context = `
Ticket #${ticket.id}
Asunto: ${ticket.subject}
Descripción: ${ticket.description}
Usuario: ${ticket.users?.email || 'Anónimo'}
Categoría: ${ticket.category}
Prioridad: ${ticket.priority}

Historial de mensajes:
${ticket.messages.map(m => `[${m.sender_type}]: ${m.content}`).join('\n')}

Por favor, genera una respuesta profesional y útil para este ticket.
`;
    
    const result = await ariaService.chat(sessionId, context);
    
    // Cerrar sesión
    await ariaService.closeSession(sessionId);
    
    return {
      response: result.response,
      confidence: 0.80, // Simplificado
      autoSent: false
    };
  },
  
  // -------------------------------------------
  // ESTADÍSTICAS
  // -------------------------------------------
  
  async getStats(dateFrom?: Date, dateTo?: Date) {
    const where: any = {};
    if (dateFrom || dateTo) {
      where.created_at = {};
      if (dateFrom) where.created_at.gte = dateFrom;
      if (dateTo) where.created_at.lte = dateTo;
    }
    
    const [
      total,
      byStatus,
      byPriority,
      byCategory,
      avgResponseTime,
      slaBreached
    ] = await Promise.all([
      prisma.support_tickets.count({ where }),
      prisma.support_tickets.groupBy({
        by: ['status'],
        where,
        _count: true
      }),
      prisma.support_tickets.groupBy({
        by: ['priority'],
        where,
        _count: true
      }),
      prisma.support_tickets.groupBy({
        by: ['category'],
        where,
        _count: true
      }),
      prisma.support_tickets.aggregate({
        where: { ...where, first_responded_at: { not: null } },
        _avg: {
          // Prisma no soporta diff de fechas directamente
        }
      }),
      prisma.support_tickets.count({
        where: { ...where, sla_breached: true }
      })
    ]);
    
    return {
      total,
      byStatus: Object.fromEntries(byStatus.map(s => [s.status, s._count])),
      byPriority: Object.fromEntries(byPriority.map(p => [p.priority, p._count])),
      byCategory: Object.fromEntries(byCategory.map(c => [c.category || 'unknown', c._count])),
      slaBreached
    };
  },
  
  // -------------------------------------------
  // SLA CHECKER
  // -------------------------------------------
  
  async checkSLABreaches() {
    const now = new Date();
    
    // Tickets que vencieron SLA de primera respuesta
    const firstResponseBreached = await prisma.support_tickets.updateMany({
      where: {
        status: 'open',
        first_responded_at: null,
        first_response_due: { lt: now },
        sla_breached: false
      },
      data: { sla_breached: true }
    });
    
    // Tickets que vencieron SLA de resolución
    const resolutionBreached = await prisma.support_tickets.updateMany({
      where: {
        status: { in: ['open', 'in_progress', 'waiting_customer'] },
        resolved_at: null,
        resolution_due: { lt: now },
        sla_breached: false
      },
      data: { sla_breached: true }
    });
    
    const total = firstResponseBreached.count + resolutionBreached.count;
    if (total > 0) {
      console.log(`⚠️ ${total} tickets con SLA vencido`);
    }
    
    return total;
  }
};
