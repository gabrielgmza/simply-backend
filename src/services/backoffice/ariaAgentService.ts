import { PrismaClient, Prisma } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
import { auditLogService } from './auditLogService';
import crypto from 'crypto';

const prisma = new PrismaClient();

const ARIA_CONFIG = {
  model: 'claude-sonnet-4-20250514',
  maxTokens: 4096,
  safety: { autoApproveAmount: 10000, requireHumanAmount: 100000, escalateBelowConfidence: 0.70 },
  circuitBreaker: { maxActionsPerMinute: 10, consecutiveErrorsBeforeHalt: 3, cooldownMinutes: 15 },
  rollbackWindowHours: 72
};

interface AriaContext { sessionId: string; employeeId: string; employeeRole: string; }
interface ToolResult { success: boolean; data?: any; error?: string; rollbackToken?: string; stateBefore?: any; stateAfter?: any; }
interface SafetyDecision { approved: boolean; reason?: string; requiresConfirmation: boolean; requiresHumanApproval: boolean; riskLevel: string; }

const ARIA_TOOLS: Array<{
  name: string;
  description: string;
  input_schema: Anthropic.Tool['input_schema'];
  handler: (input: any, ctx: AriaContext) => Promise<ToolResult>;
}> = [
  {
    name: 'get_user_info',
    description: 'Obtener información de un usuario por ID, email o DNI',
    input_schema: { type: 'object', properties: { identifier: { type: 'string', description: 'ID, email o DNI' } }, required: ['identifier'] },
    handler: async (input: any) => {
      const user = await prisma.users.findFirst({
        where: { OR: [{ id: input.identifier }, { email: input.identifier }, { dni: input.identifier }] },
        include: { account: true, investments: { where: { status: 'ACTIVE' } } }
      });
      return user ? { success: true, data: user } : { success: false, error: 'Usuario no encontrado' };
    }
  },
  {
    name: 'block_user',
    description: 'Bloquear un usuario por fraude o seguridad',
    input_schema: { type: 'object', properties: { userId: { type: 'string' }, reason: { type: 'string' } }, required: ['userId', 'reason'] },
    handler: async (input: any, ctx: AriaContext) => {
      const user = await prisma.users.findUnique({ where: { id: input.userId }, select: { id: true, status: true, email: true } });
      if (!user) return { success: false, error: 'Usuario no encontrado' };
      const stateBefore = { status: user.status };
      const rollbackToken = crypto.randomUUID();
      await prisma.users.update({ where: { id: input.userId }, data: { status: 'BLOCKED' } });
      await auditLogService.log({ actorType: 'system', actorId: ctx.sessionId, action: 'user_blocked', resource: 'users', resourceId: input.userId, description: `Usuario ${user.email} bloqueado por Aria: ${input.reason}`, oldData: stateBefore, newData: { status: 'BLOCKED' } });
      return { success: true, data: { userId: input.userId, newStatus: 'BLOCKED' }, rollbackToken, stateBefore, stateAfter: { status: 'BLOCKED' } };
    }
  },
  {
    name: 'unblock_user',
    description: 'Desbloquear un usuario',
    input_schema: { type: 'object', properties: { userId: { type: 'string' }, reason: { type: 'string' } }, required: ['userId', 'reason'] },
    handler: async (input: any, ctx: AriaContext) => {
      const user = await prisma.users.findUnique({ where: { id: input.userId }, select: { id: true, status: true, email: true } });
      if (!user) return { success: false, error: 'Usuario no encontrado' };
      if (user.status !== 'BLOCKED') return { success: false, error: 'Usuario no está bloqueado' };
      const stateBefore = { status: user.status };
      const rollbackToken = crypto.randomUUID();
      await prisma.users.update({ where: { id: input.userId }, data: { status: 'ACTIVE' } });
      await auditLogService.log({ actorType: 'system', actorId: ctx.sessionId, action: 'user_unblocked', resource: 'users', resourceId: input.userId, description: `Usuario ${user.email} desbloqueado por Aria`, oldData: stateBefore, newData: { status: 'ACTIVE' } });
      return { success: true, data: { userId: input.userId, newStatus: 'ACTIVE' }, rollbackToken, stateBefore, stateAfter: { status: 'ACTIVE' } };
    }
  },
  {
    name: 'get_ticket',
    description: 'Obtener información de un ticket',
    input_schema: { type: 'object', properties: { ticketId: { type: 'string' } }, required: ['ticketId'] },
    handler: async (input: any) => {
      const ticket = await prisma.support_tickets.findUnique({ where: { id: input.ticketId }, include: { users: { select: { id: true, email: true, first_name: true } }, messages: { orderBy: { created_at: 'asc' } } } });
      return ticket ? { success: true, data: ticket } : { success: false, error: 'Ticket no encontrado' };
    }
  },
  {
    name: 'respond_ticket',
    description: 'Responder a un ticket de soporte',
    input_schema: { type: 'object', properties: { ticketId: { type: 'string' }, message: { type: 'string' }, closeTicket: { type: 'boolean' } }, required: ['ticketId', 'message'] },
    handler: async (input: any, ctx: AriaContext) => {
      const ticket = await prisma.support_tickets.findUnique({ where: { id: input.ticketId } });
      if (!ticket) return { success: false, error: 'Ticket no encontrado' };
      await prisma.ticket_messages.create({ data: { ticket_id: input.ticketId, sender_type: 'employee', sender_id: ctx.sessionId, content: input.message, aria_generated: true } });
      const updateData: any = { updated_at: new Date() };
      if (input.closeTicket) { updateData.status = 'resolved'; updateData.resolved_at = new Date(); }
      else if (ticket.status === 'open') { updateData.status = 'in_progress'; if (!ticket.first_responded_at) updateData.first_responded_at = new Date(); }
      await prisma.support_tickets.update({ where: { id: input.ticketId }, data: updateData });
      return { success: true, data: { ticketId: input.ticketId, status: updateData.status || ticket.status } };
    }
  },
  {
    name: 'get_system_stats',
    description: 'Obtener estadísticas del sistema',
    input_schema: { type: 'object', properties: {} },
    handler: async () => {
      const [totalUsers, activeUsers, pendingTickets] = await Promise.all([
        prisma.users.count(), prisma.users.count({ where: { status: 'ACTIVE' } }),
        prisma.support_tickets.count({ where: { status: { in: ['open', 'in_progress'] } } })
      ]);
      return { success: true, data: { users: { total: totalUsers, active: activeUsers }, pendingTickets } };
    }
  }
];

class SafetyGuardrails {
  async evaluate(toolName: string, _input: any, confidence: number, context: AriaContext): Promise<SafetyDecision> {
    const circuitStatus = await this.checkCircuitBreaker(context.employeeId);
    if (circuitStatus.isOpen) return { approved: false, reason: circuitStatus.reason, requiresConfirmation: false, requiresHumanApproval: true, riskLevel: 'critical' };
    const riskLevel = ['block_user', 'unblock_user'].includes(toolName) ? (confidence < 0.80 ? 'critical' : confidence < 0.90 ? 'high' : 'medium') : 'low';
    if (confidence < ARIA_CONFIG.safety.escalateBelowConfidence) return { approved: false, reason: `Confianza baja: ${(confidence * 100).toFixed(0)}%`, requiresConfirmation: false, requiresHumanApproval: true, riskLevel };
    return { approved: true, requiresConfirmation: false, requiresHumanApproval: false, riskLevel };
  }

  async checkCircuitBreaker(employeeId: string): Promise<{ isOpen: boolean; reason?: string }> {
    let rateLimit = await prisma.aria_rate_limits.findUnique({ where: { employee_id: employeeId } });
    if (!rateLimit) rateLimit = await prisma.aria_rate_limits.create({ data: { employee_id: employeeId } });
    if (rateLimit.circuit_open) {
      if (rateLimit.circuit_opens_at) {
        const cooldownEnd = new Date(rateLimit.circuit_opens_at.getTime() + ARIA_CONFIG.circuitBreaker.cooldownMinutes * 60 * 1000);
        if (new Date() < cooldownEnd) return { isOpen: true, reason: 'Cooldown activo' };
        await prisma.aria_rate_limits.update({ where: { employee_id: employeeId }, data: { circuit_open: false, consecutive_errors: 0 } });
      }
    }
    if (rateLimit.actions_this_minute >= ARIA_CONFIG.circuitBreaker.maxActionsPerMinute) return { isOpen: true, reason: 'Límite excedido' };
    if (rateLimit.consecutive_errors >= ARIA_CONFIG.circuitBreaker.consecutiveErrorsBeforeHalt) return { isOpen: true, reason: 'Errores consecutivos' };
    return { isOpen: false };
  }

  async recordAction(employeeId: string, success: boolean) {
    const rateLimit = await prisma.aria_rate_limits.findUnique({ where: { employee_id: employeeId } });
    if (!rateLimit) return;
    const now = new Date();
    const minuteAgo = new Date(now.getTime() - 60 * 1000);
    const updates: any = { last_action_at: now };
    if (rateLimit.reset_minute_at < minuteAgo) { updates.actions_this_minute = 1; updates.reset_minute_at = now; }
    else { updates.actions_this_minute = rateLimit.actions_this_minute + 1; }
    if (success) { updates.consecutive_errors = 0; }
    else { updates.consecutive_errors = rateLimit.consecutive_errors + 1; if (updates.consecutive_errors >= ARIA_CONFIG.circuitBreaker.consecutiveErrorsBeforeHalt) { updates.circuit_open = true; updates.circuit_opens_at = now; } }
    await prisma.aria_rate_limits.update({ where: { employee_id: employeeId }, data: updates });
  }
}

const safetyGuardrails = new SafetyGuardrails();

export const ariaService = {
  async createSession(employeeId: string): Promise<string> {
    const session = await prisma.aria_sessions.create({ data: { employee_id: employeeId, context: {} } });
    return session.id;
  },

  async chat(sessionId: string, message: string): Promise<{ response: string; toolsUsed: string[]; decisions: any[] }> {
    const session = await prisma.aria_sessions.findUnique({ where: { id: sessionId }, include: { employees: true, messages: { orderBy: { created_at: 'desc' }, take: 20 } } });
    if (!session) throw new Error('Sesión no encontrada');

    const ariaContext: AriaContext = { sessionId, employeeId: session.employee_id, employeeRole: session.employees.role };
    await prisma.aria_messages.create({ data: { session_id: sessionId, role: 'user', content: message } });

    const conversationHistory = session.messages.reverse().map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    const tools: Anthropic.Tool[] = ARIA_TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema }));

    const systemPrompt = `Eres Aria, la asistente AI de Simply Backoffice. Ayudas a los empleados de PaySur.
EMPLEADO: ${session.employees.first_name} ${session.employees.last_name} (${session.employees.role})
CAPACIDADES: Consultar usuarios, bloquear/desbloquear, responder tickets, estadísticas
REGLAS: Verificar antes de actuar, preguntar si no hay suficiente info, ser profesional en español argentino`;

    const anthropic = new Anthropic();
    const toolsUsed: string[] = [];
    const decisions: any[] = [];
    let finalResponse = '';
    let messages: Anthropic.MessageParam[] = [...conversationHistory, { role: 'user', content: message }];

    while (true) {
      const response = await anthropic.messages.create({ model: ARIA_CONFIG.model, max_tokens: ARIA_CONFIG.maxTokens, system: systemPrompt, tools, messages });

      if (response.stop_reason === 'end_turn') {
        for (const block of response.content) { if (block.type === 'text') finalResponse = block.text; }
        break;
      }

      if (response.stop_reason === 'tool_use') {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type === 'tool_use') {
            const toolName = block.name;
            const toolInput = block.input as Record<string, unknown>;
            toolsUsed.push(toolName);

            const tool = ARIA_TOOLS.find(t => t.name === toolName);
            if (!tool) { toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: 'Tool not found' }) }); continue; }

            const confidence = 0.85;
            const safetyDecision = await safetyGuardrails.evaluate(toolName, toolInput, confidence, ariaContext);

            const decision = await prisma.aria_decisions.create({
              data: {
                session_id: sessionId, request_type: 'tool_execution',
                request_context: { toolName, toolInput: JSON.stringify(toolInput), message },
                confidence_score: confidence,
                safety_evaluation: { approved: safetyDecision.approved, reason: safetyDecision.reason || '', riskLevel: safetyDecision.riskLevel },
                risk_level: safetyDecision.riskLevel, tool_name: toolName,
                tool_input: toolInput as Prisma.InputJsonValue,
                status: safetyDecision.approved ? 'pending' : 'rejected'
              }
            });
            decisions.push(decision);

            if (!safetyDecision.approved) {
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: `Bloqueado: ${safetyDecision.reason}` }) });
              continue;
            }

            try {
              const result = await tool.handler(toolInput, ariaContext);
              await prisma.aria_decisions.update({
                where: { id: decision.id },
                data: {
                  tool_output: JSON.parse(JSON.stringify(result)),
                  state_before: result.stateBefore ? JSON.parse(JSON.stringify(result.stateBefore)) : Prisma.DbNull,
                  state_after: result.stateAfter ? JSON.parse(JSON.stringify(result.stateAfter)) : Prisma.DbNull,
                  rollback_token: result.rollbackToken,
                  rollback_expires_at: result.rollbackToken ? new Date(Date.now() + ARIA_CONFIG.rollbackWindowHours * 60 * 60 * 1000) : null,
                  status: result.success ? 'executed' : 'rejected', executed_by: 'aria_auto', executed_at: new Date()
                }
              });
              await safetyGuardrails.recordAction(ariaContext.employeeId, result.success);
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
            } catch (error: any) {
              await safetyGuardrails.recordAction(ariaContext.employeeId, false);
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: error.message }) });
            }
          }
        }
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });
      }
    }

    await prisma.aria_messages.create({ data: { session_id: sessionId, role: 'assistant', content: finalResponse, tool_calls: toolsUsed.length > 0 ? toolsUsed : Prisma.DbNull, model_id: ARIA_CONFIG.model } });
    await prisma.aria_sessions.update({ where: { id: sessionId }, data: { last_activity: new Date() } });

    return { response: finalResponse, toolsUsed, decisions };
  },

  async rollback(decisionId: string, employeeId: string, reason: string): Promise<{ success: boolean; error?: string }> {
    const decision = await prisma.aria_decisions.findUnique({ where: { id: decisionId } });
    if (!decision) return { success: false, error: 'Decisión no encontrada' };
    if (decision.status !== 'executed') return { success: false, error: 'Solo acciones ejecutadas' };
    if (!decision.rollback_token) return { success: false, error: 'No soporta rollback' };
    if (decision.rollback_expires_at && decision.rollback_expires_at < new Date()) return { success: false, error: 'Rollback expirado' };

    const toolName = decision.tool_name;
    const stateBefore = decision.state_before as any;

    try {
      if (['block_user', 'unblock_user'].includes(toolName || '') && stateBefore?.status) {
        const input = decision.tool_input as any;
        if (input?.userId) await prisma.users.update({ where: { id: input.userId }, data: { status: stateBefore.status } });
      } else return { success: false, error: `Rollback no implementado: ${toolName}` };

      await prisma.aria_decisions.update({ where: { id: decisionId }, data: { status: 'rolled_back', rolled_back_at: new Date(), rolled_back_by: employeeId, rollback_reason: reason } });
      await auditLogService.log({ actorType: 'employee', actorId: employeeId, action: 'aria_rollback', resource: 'aria_decisions', resourceId: decisionId, description: `Rollback: ${toolName}`, metadata: { reason } });
      return { success: true };
    } catch (error: any) { return { success: false, error: error.message }; }
  },

  async getSession(sessionId: string) {
    return prisma.aria_sessions.findUnique({ where: { id: sessionId }, include: { employees: { select: { id: true, email: true, first_name: true, last_name: true, role: true } }, messages: { orderBy: { created_at: 'asc' } }, decisions: { orderBy: { created_at: 'desc' }, take: 20 } } });
  },

  async getEmployeeSessions(employeeId: string, limit = 20) {
    return prisma.aria_sessions.findMany({ where: { employee_id: employeeId }, orderBy: { last_activity: 'desc' }, take: limit, include: { _count: { select: { messages: true, decisions: true } } } });
  },

  async closeSession(sessionId: string) {
    return prisma.aria_sessions.update({ where: { id: sessionId }, data: { status: 'closed', closed_at: new Date() } });
  }
};
