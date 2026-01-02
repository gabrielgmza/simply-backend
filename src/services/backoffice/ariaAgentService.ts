import { PrismaClient } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
import { rbacService } from './rbacService';
import { auditLogService } from './auditLogService';
import crypto from 'crypto';

const prisma = new PrismaClient();

// ============================================
// CONFIGURACIÓN
// ============================================

const ARIA_CONFIG = {
  model: 'claude-sonnet-4-20250514',
  maxTokens: 4096,
  
  // Safety thresholds
  safety: {
    autoApproveAmount: 10000,        // ARS - auto aprobar bajo este monto
    requireConfirmAmount: 50000,     // ARS - requiere confirmación
    requireHumanAmount: 100000,      // ARS - requiere humano
    minConfidenceAutoExecute: 0.90,  // Confianza mínima para auto-ejecutar
    minConfidenceWithReview: 0.70,   // Con review
    escalateBelowConfidence: 0.70    // Escalar si está por debajo
  },
  
  // Circuit breaker
  circuitBreaker: {
    maxActionsPerMinute: 10,
    maxDollarVolumePerHour: 500000,  // ARS
    consecutiveErrorsBeforeHalt: 3,
    cooldownMinutes: 15
  },
  
  // Rollback
  rollbackWindowHours: 72
};

// ============================================
// TIPOS
// ============================================

interface SafetyDecision {
  approved: boolean;
  reason?: string;
  requiresConfirmation: boolean;
  requiresHumanApproval: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  handler: (input: any, context: AriaContext) => Promise<ToolResult>;
}

interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  rollbackToken?: string;
  stateBefore?: any;
  stateAfter?: any;
}

interface AriaContext {
  sessionId: string;
  employeeId: string;
  employeeRole: string;
  ipAddress?: string;
}

// ============================================
// ARIA TOOLS (Herramientas que puede ejecutar)
// ============================================

const ARIA_TOOLS: ToolDefinition[] = [
  // --- USUARIOS ---
  {
    name: 'get_user_info',
    description: 'Obtener información completa de un usuario por ID, email o DNI',
    inputSchema: {
      type: 'object',
      properties: {
        identifier: { type: 'string', description: 'ID, email o DNI del usuario' }
      },
      required: ['identifier']
    },
    handler: async (input, ctx) => {
      const user = await prisma.users.findFirst({
        where: {
          OR: [
            { id: input.identifier },
            { email: input.identifier },
            { dni: input.identifier }
          ]
        },
        include: {
          account: true,
          investments: { where: { status: 'ACTIVE' } },
          financings: { where: { status: 'ACTIVE' } },
          risk_flags: { where: { status: 'active' } }
        }
      });
      
      if (!user) return { success: false, error: 'Usuario no encontrado' };
      
      return { success: true, data: user };
    }
  },
  
  {
    name: 'block_user',
    description: 'Bloquear un usuario por fraude, abuso o seguridad. OPERACIÓN SENSIBLE.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        reason: { 
          type: 'string', 
          enum: ['fraud', 'abuse', 'compliance', 'security', 'request'] 
        },
        duration: { 
          type: 'string', 
          enum: ['temporary', 'permanent'],
          default: 'temporary'
        },
        durationHours: { type: 'number', default: 24 },
        internalNote: { type: 'string' }
      },
      required: ['userId', 'reason']
    },
    handler: async (input, ctx) => {
      const user = await prisma.users.findUnique({
        where: { id: input.userId },
        select: { id: true, status: true, email: true }
      });
      
      if (!user) return { success: false, error: 'Usuario no encontrado' };
      
      const stateBefore = { status: user.status };
      const rollbackToken = crypto.randomUUID();
      
      await prisma.users.update({
        where: { id: input.userId },
        data: { status: 'BLOCKED' }
      });
      
      // Log de auditoría
      await auditLogService.log({
        actorType: 'aria',
        actorId: ctx.sessionId,
        action: 'user_blocked',
        resource: 'users',
        resourceId: input.userId,
        description: `Usuario ${user.email} bloqueado por Aria. Razón: ${input.reason}`,
        oldData: stateBefore,
        newData: { status: 'BLOCKED' },
        metadata: { ariaSession: ctx.sessionId, reason: input.reason }
      });
      
      return {
        success: true,
        data: { userId: input.userId, newStatus: 'BLOCKED' },
        rollbackToken,
        stateBefore,
        stateAfter: { status: 'BLOCKED' }
      };
    }
  },
  
  {
    name: 'unblock_user',
    description: 'Desbloquear un usuario previamente bloqueado',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        reason: { type: 'string' }
      },
      required: ['userId', 'reason']
    },
    handler: async (input, ctx) => {
      const user = await prisma.users.findUnique({
        where: { id: input.userId },
        select: { id: true, status: true, email: true }
      });
      
      if (!user) return { success: false, error: 'Usuario no encontrado' };
      if (user.status !== 'BLOCKED') return { success: false, error: 'Usuario no está bloqueado' };
      
      const stateBefore = { status: user.status };
      const rollbackToken = crypto.randomUUID();
      
      await prisma.users.update({
        where: { id: input.userId },
        data: { status: 'ACTIVE' }
      });
      
      await auditLogService.log({
        actorType: 'aria',
        actorId: ctx.sessionId,
        action: 'user_unblocked',
        resource: 'users',
        resourceId: input.userId,
        description: `Usuario ${user.email} desbloqueado por Aria`,
        oldData: stateBefore,
        newData: { status: 'ACTIVE' }
      });
      
      return {
        success: true,
        data: { userId: input.userId, newStatus: 'ACTIVE' },
        rollbackToken,
        stateBefore,
        stateAfter: { status: 'ACTIVE' }
      };
    }
  },
  
  {
    name: 'adjust_user_limits',
    description: 'Ajustar límites diarios/mensuales de un usuario',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        dailyLimit: { type: 'number' },
        monthlyLimit: { type: 'number' },
        reason: { type: 'string' }
      },
      required: ['userId', 'reason']
    },
    handler: async (input, ctx) => {
      const account = await prisma.accounts.findFirst({
        where: { user_id: input.userId }
      });
      
      if (!account) return { success: false, error: 'Cuenta no encontrada' };
      
      const stateBefore = {
        dailyLimit: account.daily_limit,
        monthlyLimit: account.monthly_limit
      };
      
      const rollbackToken = crypto.randomUUID();
      
      await prisma.accounts.update({
        where: { id: account.id },
        data: {
          daily_limit: input.dailyLimit || account.daily_limit,
          monthly_limit: input.monthlyLimit || account.monthly_limit
        }
      });
      
      return {
        success: true,
        data: {
          dailyLimit: input.dailyLimit || account.daily_limit,
          monthlyLimit: input.monthlyLimit || account.monthly_limit
        },
        rollbackToken,
        stateBefore,
        stateAfter: {
          dailyLimit: input.dailyLimit || account.daily_limit,
          monthlyLimit: input.monthlyLimit || account.monthly_limit
        }
      };
    }
  },
  
  // --- TICKETS ---
  {
    name: 'get_ticket',
    description: 'Obtener información de un ticket de soporte',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: { type: 'string' }
      },
      required: ['ticketId']
    },
    handler: async (input, ctx) => {
      const ticket = await prisma.support_tickets.findUnique({
        where: { id: input.ticketId },
        include: {
          users: { select: { id: true, email: true, first_name: true, last_name: true } },
          messages: { orderBy: { created_at: 'asc' } }
        }
      });
      
      if (!ticket) return { success: false, error: 'Ticket no encontrado' };
      
      return { success: true, data: ticket };
    }
  },
  
  {
    name: 'respond_ticket',
    description: 'Responder a un ticket de soporte. Aria puede responder directamente si tiene suficiente confianza.',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: { type: 'string' },
        message: { type: 'string' },
        isInternal: { type: 'boolean', default: false },
        closeTicket: { type: 'boolean', default: false }
      },
      required: ['ticketId', 'message']
    },
    handler: async (input, ctx) => {
      const ticket = await prisma.support_tickets.findUnique({
        where: { id: input.ticketId }
      });
      
      if (!ticket) return { success: false, error: 'Ticket no encontrado' };
      
      // Crear mensaje
      const message = await prisma.ticket_messages.create({
        data: {
          ticket_id: input.ticketId,
          sender_type: 'aria',
          sender_id: ctx.sessionId,
          content: input.message,
          is_internal: input.isInternal || false,
          aria_generated: true,
          aria_decision_id: ctx.sessionId
        }
      });
      
      // Actualizar ticket
      const updateData: any = {
        updated_at: new Date()
      };
      
      if (input.closeTicket) {
        updateData.status = 'resolved';
        updateData.resolved_at = new Date();
      } else if (ticket.status === 'open') {
        updateData.status = 'in_progress';
        if (!ticket.first_responded_at) {
          updateData.first_responded_at = new Date();
        }
      }
      
      await prisma.support_tickets.update({
        where: { id: input.ticketId },
        data: updateData
      });
      
      return {
        success: true,
        data: { messageId: message.id, ticketStatus: updateData.status || ticket.status }
      };
    }
  },
  
  {
    name: 'escalate_ticket',
    description: 'Escalar un ticket a un equipo o empleado específico',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: { type: 'string' },
        team: { type: 'string', enum: ['compliance', 'fraud', 'finance', 'technical'] },
        reason: { type: 'string' },
        priority: { type: 'string', enum: ['medium', 'high', 'urgent'] }
      },
      required: ['ticketId', 'team', 'reason']
    },
    handler: async (input, ctx) => {
      await prisma.support_tickets.update({
        where: { id: input.ticketId },
        data: {
          assigned_team: input.team,
          priority: input.priority || 'high',
          status: 'in_progress'
        }
      });
      
      // Agregar nota interna
      await prisma.ticket_messages.create({
        data: {
          ticket_id: input.ticketId,
          sender_type: 'aria',
          sender_id: ctx.sessionId,
          content: `⚠️ Ticket escalado a ${input.team}. Razón: ${input.reason}`,
          is_internal: true,
          aria_generated: true
        }
      });
      
      return {
        success: true,
        data: { team: input.team, priority: input.priority }
      };
    }
  },
  
  // --- FRAUD ALERTS ---
  {
    name: 'review_fraud_alert',
    description: 'Revisar y tomar acción sobre una alerta de fraude',
    inputSchema: {
      type: 'object',
      properties: {
        alertId: { type: 'string' },
        decision: { 
          type: 'string', 
          enum: ['dismiss', 'confirm_fraud', 'escalate', 'request_info'] 
        },
        notes: { type: 'string' },
        blockUser: { type: 'boolean', default: false }
      },
      required: ['alertId', 'decision']
    },
    handler: async (input, ctx) => {
      const alert = await prisma.fraud_alerts.findUnique({
        where: { id: input.alertId },
        include: { users: true }
      });
      
      if (!alert) return { success: false, error: 'Alerta no encontrada' };
      
      const statusMap: Record<string, string> = {
        'dismiss': 'FALSE_POSITIVE',
        'confirm_fraud': 'RESOLVED',
        'escalate': 'ESCALATED',
        'request_info': 'REVIEWING'
      };
      
      await prisma.fraud_alerts.update({
        where: { id: input.alertId },
        data: {
          status: statusMap[input.decision],
          reviewed_by: `aria:${ctx.sessionId}`,
          reviewed_at: new Date(),
          notes: input.notes
        }
      });
      
      // Si confirma fraude y debe bloquear
      if (input.decision === 'confirm_fraud' && input.blockUser) {
        await prisma.users.update({
          where: { id: alert.user_id },
          data: { status: 'BLOCKED' }
        });
      }
      
      return {
        success: true,
        data: { alertId: input.alertId, newStatus: statusMap[input.decision] }
      };
    }
  },
  
  // --- INVERSIONES ---
  {
    name: 'get_investment_info',
    description: 'Obtener información de una inversión',
    inputSchema: {
      type: 'object',
      properties: {
        investmentId: { type: 'string' }
      },
      required: ['investmentId']
    },
    handler: async (input, ctx) => {
      const investment = await prisma.investments.findUnique({
        where: { id: input.investmentId },
        include: {
          user: { select: { id: true, email: true, first_name: true, last_name: true } },
          financings: true,
          returns: { orderBy: { return_date: 'desc' }, take: 30 }
        }
      });
      
      if (!investment) return { success: false, error: 'Inversión no encontrada' };
      
      return { success: true, data: investment };
    }
  },
  
  // --- CONSULTAS GENERALES ---
  {
    name: 'search_audit_logs',
    description: 'Buscar en los logs de auditoría',
    inputSchema: {
      type: 'object',
      properties: {
        resource: { type: 'string' },
        resourceId: { type: 'string' },
        action: { type: 'string' },
        actorId: { type: 'string' },
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
        limit: { type: 'number', default: 50 }
      }
    },
    handler: async (input, ctx) => {
      const where: any = {};
      
      if (input.resource) where.resource = input.resource;
      if (input.resourceId) where.resource_id = input.resourceId;
      if (input.action) where.action = { contains: input.action };
      if (input.actorId) where.actor_id = input.actorId;
      if (input.dateFrom || input.dateTo) {
        where.created_at = {};
        if (input.dateFrom) where.created_at.gte = new Date(input.dateFrom);
        if (input.dateTo) where.created_at.lte = new Date(input.dateTo);
      }
      
      const logs = await prisma.audit_logs.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: input.limit || 50
      });
      
      return { success: true, data: logs };
    }
  },
  
  {
    name: 'get_system_stats',
    description: 'Obtener estadísticas del sistema',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    handler: async (input, ctx) => {
      const [
        totalUsers,
        activeUsers,
        totalInvestments,
        activeInvestments,
        pendingTickets,
        openFraudAlerts
      ] = await Promise.all([
        prisma.users.count(),
        prisma.users.count({ where: { status: 'ACTIVE' } }),
        prisma.investments.count(),
        prisma.investments.count({ where: { status: 'ACTIVE' } }),
        prisma.support_tickets.count({ where: { status: { in: ['open', 'in_progress'] } } }),
        prisma.fraud_alerts.count({ where: { status: 'PENDING' } })
      ]);
      
      return {
        success: true,
        data: {
          users: { total: totalUsers, active: activeUsers },
          investments: { total: totalInvestments, active: activeInvestments },
          pendingTickets,
          openFraudAlerts
        }
      };
    }
  }
];

// ============================================
// SAFETY GUARDRAILS
// ============================================

class SafetyGuardrails {
  async evaluate(
    toolName: string,
    input: any,
    confidence: number,
    context: AriaContext
  ): Promise<SafetyDecision> {
    // 1. Verificar circuit breaker
    const circuitStatus = await this.checkCircuitBreaker(context.employeeId);
    if (circuitStatus.isOpen) {
      return {
        approved: false,
        reason: `Circuit breaker abierto: ${circuitStatus.reason}`,
        requiresConfirmation: false,
        requiresHumanApproval: true,
        riskLevel: 'critical'
      };
    }
    
    // 2. Verificar permisos del empleado para esta acción
    const toolPermission = this.getToolPermission(toolName);
    if (toolPermission) {
      const hasPermission = await rbacService.checkPermission(
        context.employeeId,
        toolPermission.resource,
        toolPermission.action
      );
      if (!hasPermission.allowed) {
        return {
          approved: false,
          reason: `Empleado no tiene permiso para ${toolName}`,
          requiresConfirmation: false,
          requiresHumanApproval: false,
          riskLevel: 'high'
        };
      }
    }
    
    // 3. Evaluar monto (si aplica)
    const dollarAmount = this.extractDollarAmount(toolName, input);
    
    // 4. Evaluar riesgo
    const riskLevel = this.calculateRiskLevel(toolName, input, confidence, dollarAmount);
    
    // 5. Decisión basada en confianza y monto
    if (confidence < ARIA_CONFIG.safety.escalateBelowConfidence) {
      return {
        approved: false,
        reason: `Confianza muy baja: ${(confidence * 100).toFixed(1)}%`,
        requiresConfirmation: false,
        requiresHumanApproval: true,
        riskLevel
      };
    }
    
    if (dollarAmount && dollarAmount > ARIA_CONFIG.safety.requireHumanAmount) {
      return {
        approved: false,
        reason: `Monto ${dollarAmount} excede límite de auto-aprobación`,
        requiresConfirmation: false,
        requiresHumanApproval: true,
        riskLevel
      };
    }
    
    if (this.isSensitiveTool(toolName)) {
      if (confidence < 0.95) {
        return {
          approved: true,
          requiresConfirmation: true,
          requiresHumanApproval: false,
          riskLevel
        };
      }
    }
    
    return {
      approved: true,
      requiresConfirmation: dollarAmount ? dollarAmount > ARIA_CONFIG.safety.autoApproveAmount : false,
      requiresHumanApproval: false,
      riskLevel
    };
  }
  
  private getToolPermission(toolName: string): { resource: string; action: string } | null {
    const mapping: Record<string, { resource: string; action: string }> = {
      'block_user': { resource: 'users', action: 'update' },
      'unblock_user': { resource: 'users', action: 'update' },
      'adjust_user_limits': { resource: 'users', action: 'update' },
      'respond_ticket': { resource: 'tickets', action: 'update' },
      'escalate_ticket': { resource: 'tickets', action: 'update' },
      'review_fraud_alert': { resource: 'fraud', action: 'update' }
    };
    return mapping[toolName] || null;
  }
  
  private extractDollarAmount(toolName: string, input: any): number | null {
    if (input.amount) return input.amount;
    if (input.dailyLimit) return input.dailyLimit;
    if (input.monthlyLimit) return input.monthlyLimit;
    return null;
  }
  
  private calculateRiskLevel(
    toolName: string,
    input: any,
    confidence: number,
    amount: number | null
  ): 'low' | 'medium' | 'high' | 'critical' {
    const sensitiveTools = ['block_user', 'adjust_user_limits', 'review_fraud_alert'];
    
    if (sensitiveTools.includes(toolName)) {
      if (confidence < 0.80) return 'critical';
      if (confidence < 0.90) return 'high';
      return 'medium';
    }
    
    if (amount && amount > ARIA_CONFIG.safety.requireHumanAmount) return 'high';
    if (amount && amount > ARIA_CONFIG.safety.requireConfirmAmount) return 'medium';
    
    return 'low';
  }
  
  private isSensitiveTool(toolName: string): boolean {
    return ['block_user', 'adjust_user_limits', 'review_fraud_alert'].includes(toolName);
  }
  
  async checkCircuitBreaker(employeeId: string): Promise<{ isOpen: boolean; reason?: string }> {
    let rateLimit = await prisma.aria_rate_limits.findUnique({
      where: { employee_id: employeeId }
    });
    
    if (!rateLimit) {
      rateLimit = await prisma.aria_rate_limits.create({
        data: { employee_id: employeeId }
      });
    }
    
    // Check if circuit is open
    if (rateLimit.circuit_open) {
      if (rateLimit.circuit_opens_at) {
        const cooldownEnd = new Date(rateLimit.circuit_opens_at.getTime() + 
          ARIA_CONFIG.circuitBreaker.cooldownMinutes * 60 * 1000);
        
        if (new Date() < cooldownEnd) {
          return { isOpen: true, reason: 'Cooldown activo por errores consecutivos' };
        } else {
          // Reset circuit
          await prisma.aria_rate_limits.update({
            where: { employee_id: employeeId },
            data: { circuit_open: false, consecutive_errors: 0 }
          });
        }
      }
    }
    
    // Check rate limits
    if (rateLimit.actions_this_minute >= ARIA_CONFIG.circuitBreaker.maxActionsPerMinute) {
      return { isOpen: true, reason: 'Límite de acciones por minuto excedido' };
    }
    
    if (Number(rateLimit.dollar_volume_hour) >= ARIA_CONFIG.circuitBreaker.maxDollarVolumePerHour) {
      return { isOpen: true, reason: 'Volumen de operaciones por hora excedido' };
    }
    
    if (rateLimit.consecutive_errors >= ARIA_CONFIG.circuitBreaker.consecutiveErrorsBeforeHalt) {
      return { isOpen: true, reason: 'Demasiados errores consecutivos' };
    }
    
    return { isOpen: false };
  }
  
  async recordAction(employeeId: string, success: boolean, dollarAmount?: number) {
    const now = new Date();
    
    const rateLimit = await prisma.aria_rate_limits.findUnique({
      where: { employee_id: employeeId }
    });
    
    if (!rateLimit) return;
    
    // Reset counters if needed
    const minuteAgo = new Date(now.getTime() - 60 * 1000);
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    const updates: any = {
      last_action_at: now
    };
    
    if (rateLimit.reset_minute_at < minuteAgo) {
      updates.actions_this_minute = 1;
      updates.reset_minute_at = now;
    } else {
      updates.actions_this_minute = rateLimit.actions_this_minute + 1;
    }
    
    if (rateLimit.reset_hour_at < hourAgo) {
      updates.actions_this_hour = 1;
      updates.dollar_volume_hour = dollarAmount || 0;
      updates.reset_hour_at = now;
    } else {
      updates.actions_this_hour = rateLimit.actions_this_hour + 1;
      if (dollarAmount) {
        updates.dollar_volume_hour = Number(rateLimit.dollar_volume_hour) + dollarAmount;
      }
    }
    
    if (success) {
      updates.consecutive_errors = 0;
    } else {
      updates.consecutive_errors = rateLimit.consecutive_errors + 1;
      if (updates.consecutive_errors >= ARIA_CONFIG.circuitBreaker.consecutiveErrorsBeforeHalt) {
        updates.circuit_open = true;
        updates.circuit_opens_at = now;
      }
    }
    
    await prisma.aria_rate_limits.update({
      where: { employee_id: employeeId },
      data: updates
    });
  }
}

// ============================================
// ARIA SERVICE
// ============================================

const safetyGuardrails = new SafetyGuardrails();

export const ariaService = {
  // -------------------------------------------
  // CREAR SESIÓN
  // -------------------------------------------
  
  async createSession(employeeId: string): Promise<string> {
    const session = await prisma.aria_sessions.create({
      data: {
        employee_id: employeeId,
        context: {}
      }
    });
    
    return session.id;
  },
  
  // -------------------------------------------
  // CHAT CON ARIA
  // -------------------------------------------
  
  async chat(
    sessionId: string,
    message: string,
    context?: { ipAddress?: string }
  ): Promise<{
    response: string;
    toolsUsed: string[];
    decisions: any[];
  }> {
    // 1. Obtener sesión y empleado
    const session = await prisma.aria_sessions.findUnique({
      where: { id: sessionId },
      include: {
        employees: true,
        messages: {
          orderBy: { created_at: 'desc' },
          take: 20
        }
      }
    });
    
    if (!session) throw new Error('Sesión no encontrada');
    
    const ariaContext: AriaContext = {
      sessionId,
      employeeId: session.employee_id,
      employeeRole: session.employees.role,
      ipAddress: context?.ipAddress
    };
    
    // 2. Guardar mensaje del usuario
    await prisma.aria_messages.create({
      data: {
        session_id: sessionId,
        role: 'user',
        content: message
      }
    });
    
    // 3. Construir historial de conversación
    const conversationHistory = session.messages
      .reverse()
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      }));
    
    // 4. Preparar tools para Claude
    const tools = ARIA_TOOLS.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema
    }));
    
    // 5. System prompt
    const systemPrompt = this.buildSystemPrompt(session.employees);
    
    // 6. Llamar a Claude
    const anthropic = new Anthropic();
    
    const toolsUsed: string[] = [];
    const decisions: any[] = [];
    let finalResponse = '';
    
    // Agentic loop
    let messages: any[] = [
      ...conversationHistory,
      { role: 'user', content: message }
    ];
    
    while (true) {
      const response = await anthropic.messages.create({
        model: ARIA_CONFIG.model,
        max_tokens: ARIA_CONFIG.maxTokens,
        system: systemPrompt,
        tools,
        messages
      });
      
      // Procesar respuesta
      if (response.stop_reason === 'end_turn') {
        // Extraer texto final
        for (const block of response.content) {
          if (block.type === 'text') {
            finalResponse = block.text;
          }
        }
        break;
      }
      
      if (response.stop_reason === 'tool_use') {
        // Procesar tool calls
        const toolResults: any[] = [];
        
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            const toolName = block.name;
            const toolInput = block.input;
            
            toolsUsed.push(toolName);
            
            // Encontrar handler
            const tool = ARIA_TOOLS.find(t => t.name === toolName);
            if (!tool) {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify({ error: 'Tool not found' })
              });
              continue;
            }
            
            // Calcular confianza (simplificado)
            const confidence = 0.85; // En producción: usar el modelo para estimar
            
            // Evaluar seguridad
            const safetyDecision = await safetyGuardrails.evaluate(
              toolName,
              toolInput,
              confidence,
              ariaContext
            );
            
            // Registrar decisión
            const decision = await prisma.aria_decisions.create({
              data: {
                session_id: sessionId,
                request_type: 'tool_execution',
                request_context: { toolName, toolInput, message },
                confidence_score: confidence,
                safety_evaluation: safetyDecision,
                risk_level: safetyDecision.riskLevel,
                tool_name: toolName,
                tool_input: toolInput,
                status: safetyDecision.approved ? 'pending' : 'rejected'
              }
            });
            
            decisions.push(decision);
            
            if (!safetyDecision.approved) {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify({
                  error: `Acción bloqueada: ${safetyDecision.reason}`,
                  requiresHumanApproval: safetyDecision.requiresHumanApproval
                })
              });
              continue;
            }
            
            // Ejecutar tool
            try {
              const result = await tool.handler(toolInput, ariaContext);
              
              // Actualizar decisión
              await prisma.aria_decisions.update({
                where: { id: decision.id },
                data: {
                  tool_output: result,
                  state_before: result.stateBefore,
                  state_after: result.stateAfter,
                  rollback_token: result.rollbackToken,
                  rollback_expires_at: result.rollbackToken 
                    ? new Date(Date.now() + ARIA_CONFIG.rollbackWindowHours * 60 * 60 * 1000)
                    : null,
                  status: result.success ? 'executed' : 'rejected',
                  executed_by: 'aria_auto',
                  executed_at: new Date()
                }
              });
              
              // Registrar en rate limiter
              await safetyGuardrails.recordAction(
                ariaContext.employeeId,
                result.success,
                safetyGuardrails['extractDollarAmount'](toolName, toolInput) || undefined
              );
              
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify(result)
              });
            } catch (error: any) {
              await safetyGuardrails.recordAction(ariaContext.employeeId, false);
              
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify({ error: error.message })
              });
            }
          }
        }
        
        // Agregar respuesta del asistente y resultados de tools
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });
      }
    }
    
    // 7. Guardar respuesta
    await prisma.aria_messages.create({
      data: {
        session_id: sessionId,
        role: 'assistant',
        content: finalResponse,
        tool_calls: toolsUsed.length > 0 ? toolsUsed : null,
        model_id: ARIA_CONFIG.model
      }
    });
    
    // Actualizar última actividad
    await prisma.aria_sessions.update({
      where: { id: sessionId },
      data: { last_activity: new Date() }
    });
    
    return {
      response: finalResponse,
      toolsUsed,
      decisions
    };
  },
  
  buildSystemPrompt(employee: any): string {
    return `Eres Aria, la asistente AI de Simply Backoffice. Ayudas a los empleados de PaySur a gestionar la plataforma fintech.

CONTEXTO DEL EMPLEADO:
- Nombre: ${employee.first_name} ${employee.last_name}
- Rol: ${employee.role}
- Email: ${employee.email}

TUS CAPACIDADES:
- Puedes consultar información de usuarios, inversiones, financiamientos
- Puedes bloquear/desbloquear usuarios por motivos de seguridad
- Puedes ajustar límites de usuarios
- Puedes responder y escalar tickets de soporte
- Puedes revisar alertas de fraude
- Puedes buscar en logs de auditoría

REGLAS DE SEGURIDAD:
1. SIEMPRE verifica que la acción tiene sentido antes de ejecutarla
2. Para operaciones sensibles, explica el riesgo al empleado
3. Si no tienes suficiente información, PREGUNTA antes de actuar
4. Nunca ejecutes acciones destructivas sin confirmación explícita
5. Registra el razonamiento de cada decisión importante

ESTILO:
- Sé profesional pero amigable
- Usa español argentino
- Sé conciso pero completo
- Si algo puede salir mal, menciona los riesgos

IMPORTANTE: Tienes autoridad para ejecutar acciones directamente, pero usa buen juicio. Si algo parece sospechoso o inusual, escala a un humano.`;
  },
  
  // -------------------------------------------
  // ROLLBACK
  // -------------------------------------------
  
  async rollback(
    decisionId: string,
    employeeId: string,
    reason: string
  ): Promise<{ success: boolean; error?: string }> {
    const decision = await prisma.aria_decisions.findUnique({
      where: { id: decisionId }
    });
    
    if (!decision) return { success: false, error: 'Decisión no encontrada' };
    if (decision.status !== 'executed') return { success: false, error: 'Solo se pueden revertir acciones ejecutadas' };
    if (!decision.rollback_token) return { success: false, error: 'Esta acción no soporta rollback' };
    if (decision.rollback_expires_at && decision.rollback_expires_at < new Date()) {
      return { success: false, error: 'Ventana de rollback expirada' };
    }
    
    // Ejecutar rollback según el tool
    const toolName = decision.tool_name;
    const stateBefore = decision.state_before as any;
    
    try {
      switch (toolName) {
        case 'block_user':
        case 'unblock_user':
          if (stateBefore?.status) {
            const resourceParts = (decision.affected_resource || '').split(':');
            if (resourceParts[0] === 'users' && resourceParts[1]) {
              await prisma.users.update({
                where: { id: resourceParts[1] },
                data: { status: stateBefore.status }
              });
            }
          }
          break;
          
        case 'adjust_user_limits':
          if (stateBefore?.dailyLimit || stateBefore?.monthlyLimit) {
            const input = decision.tool_input as any;
            const account = await prisma.accounts.findFirst({
              where: { user_id: input.userId }
            });
            if (account) {
              await prisma.accounts.update({
                where: { id: account.id },
                data: {
                  daily_limit: stateBefore.dailyLimit,
                  monthly_limit: stateBefore.monthlyLimit
                }
              });
            }
          }
          break;
          
        default:
          return { success: false, error: `Rollback no implementado para ${toolName}` };
      }
      
      // Marcar como rolled back
      await prisma.aria_decisions.update({
        where: { id: decisionId },
        data: {
          status: 'rolled_back',
          rolled_back_at: new Date(),
          rolled_back_by: employeeId,
          rollback_reason: reason
        }
      });
      
      // Audit log
      await auditLogService.log({
        actorType: 'employee',
        actorId: employeeId,
        action: 'aria_rollback',
        resource: 'aria_decisions',
        resourceId: decisionId,
        description: `Rollback de decisión de Aria: ${toolName}`,
        metadata: { reason, originalDecision: decision }
      });
      
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
  
  // -------------------------------------------
  // SESIONES
  // -------------------------------------------
  
  async getSession(sessionId: string) {
    return prisma.aria_sessions.findUnique({
      where: { id: sessionId },
      include: {
        employees: {
          select: { id: true, email: true, first_name: true, last_name: true, role: true }
        },
        messages: {
          orderBy: { created_at: 'asc' }
        },
        decisions: {
          orderBy: { created_at: 'desc' },
          take: 20
        }
      }
    });
  },
  
  async getEmployeeSessions(employeeId: string, limit = 20) {
    return prisma.aria_sessions.findMany({
      where: { employee_id: employeeId },
      orderBy: { last_activity: 'desc' },
      take: limit,
      include: {
        _count: {
          select: { messages: true, decisions: true }
        }
      }
    });
  },
  
  async closeSession(sessionId: string) {
    return prisma.aria_sessions.update({
      where: { id: sessionId },
      data: {
        status: 'closed',
        closed_at: new Date()
      }
    });
  }
};
