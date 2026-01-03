import { Router } from 'express';
import { authMiddleware, requirePermission, AuthRequest } from '../middleware/auth';
import { rbacService } from '../services/backoffice/rbacService';
import { ariaService } from '../services/backoffice/ariaAgentService';
import { approvalService } from '../services/backoffice/approvalService';
import { sessionService } from '../services/backoffice/sessionService';
import { ticketService } from '../services/backoffice/ticketService';
import { providerService, PROVIDER_DEFINITIONS } from '../services/backoffice/providerService';

const router = Router();

// ============================================
// RBAC - ROLES & PERMISSIONS
// ============================================

// GET /roles - Listar roles
router.get('/rbac/roles', authMiddleware, requirePermission('employees:read'), async (req: AuthRequest, res) => {
  try {
    const roles = await rbacService.getRoles();
    res.json({ success: true, data: roles });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /roles/:id - Obtener rol por ID
router.get('/rbac/roles/:id', authMiddleware, requirePermission('employees:read'), async (req: AuthRequest, res) => {
  try {
    const role = await rbacService.getRoleById(req.params.id);
    if (!role) {
      return res.status(404).json({ success: false, error: 'Rol no encontrado' });
    }
    res.json({ success: true, data: role });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /roles - Crear rol
router.post('/rbac/roles', authMiddleware, requirePermission('employees:create'), async (req: AuthRequest, res) => {
  try {
    const { slug, name, description, parentRoleId, priority } = req.body;
    
    if (!slug || !name) {
      return res.status(400).json({ success: false, error: 'slug y name son requeridos' });
    }
    
    const role = await rbacService.createRole({ slug, name, description, parentRoleId, priority });
    res.status(201).json({ success: true, data: role });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// GET /permissions - Listar permisos
router.get('/rbac/permissions', authMiddleware, requirePermission('employees:read'), async (req: AuthRequest, res) => {
  try {
    const { resource, action } = req.query;
    const permissions = await rbacService.getPermissions({
      resource: resource as string,
      action: action as string
    });
    res.json({ success: true, data: permissions });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /roles/:roleId/permissions - Asignar permiso a rol
router.post('/rbac/roles/:roleId/permissions', authMiddleware, requirePermission('employees:update'), async (req: AuthRequest, res) => {
  try {
    const { roleId } = req.params;
    const { permissionId, effect, conditions, expiresAt } = req.body;
    
    if (!permissionId) {
      return res.status(400).json({ success: false, error: 'permissionId es requerido' });
    }
    
    const result = await rbacService.assignPermissionToRole(roleId, permissionId, {
      effect,
      conditions,
      grantedBy: req.employee!.id,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined
    });
    
    res.status(201).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// DELETE /roles/:roleId/permissions/:permissionId - Revocar permiso de rol
router.delete('/rbac/roles/:roleId/permissions/:permissionId', authMiddleware, requirePermission('employees:update'), async (req: AuthRequest, res) => {
  try {
    const { roleId, permissionId } = req.params;
    const { reason } = req.body;
    
    await rbacService.revokePermissionFromRole(roleId, permissionId, req.employee!.id, reason);
    res.json({ success: true, message: 'Permiso revocado' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// POST /employees/:employeeId/roles - Asignar rol a empleado
router.post('/rbac/employees/:employeeId/roles', authMiddleware, requirePermission('employees:update'), async (req: AuthRequest, res) => {
  try {
    const { employeeId } = req.params;
    const { roleId, expiresAt } = req.body;
    
    if (!roleId) {
      return res.status(400).json({ success: false, error: 'roleId es requerido' });
    }
    
    const result = await rbacService.assignRoleToEmployee(employeeId, roleId, {
      grantedBy: req.employee!.id,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined
    });
    
    res.status(201).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// GET /employees/:employeeId/permissions - Obtener permisos efectivos
router.get('/rbac/employees/:employeeId/permissions', authMiddleware, requirePermission('employees:read'), async (req: AuthRequest, res) => {
  try {
    const permissions = await rbacService.getEmployeeEffectivePermissions(req.params.employeeId);
    res.json({ success: true, data: permissions });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /check-permission - Verificar permiso
router.post('/rbac/check-permission', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { resource, action, amount, resourceId } = req.body;
    
    const result = await rbacService.checkPermission(
      req.employee!.id,
      resource,
      action,
      { amount, resourceId, ipAddress: req.ip }
    );
    
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ARIA - AI AGENT
// ============================================

// POST /aria/sessions - Crear sesión
router.post('/aria/sessions', authMiddleware, requirePermission('aria:use'), async (req: AuthRequest, res) => {
  try {
    const sessionId = await ariaService.createSession(req.employee!.id);
    res.status(201).json({ success: true, data: { sessionId } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /aria/sessions/:sessionId/chat - Enviar mensaje
router.post('/aria/sessions/:sessionId/chat', authMiddleware, requirePermission('aria:use'), async (req: AuthRequest, res) => {
  try {
    const { sessionId } = req.params;
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ success: false, error: 'message es requerido' });
    }
    
    const response = await ariaService.chat(sessionId, message);
    
    res.json({ success: true, data: response });
  } catch (error: any) {
    console.error('Aria chat error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /aria/sessions/:sessionId - Obtener sesión
router.get('/aria/sessions/:sessionId', authMiddleware, requirePermission('aria:use'), async (req: AuthRequest, res) => {
  try {
    const session = await ariaService.getSession(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Sesión no encontrada' });
    }
    res.json({ success: true, data: session });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /aria/sessions - Listar sesiones del empleado
router.get('/aria/sessions', authMiddleware, requirePermission('aria:use'), async (req: AuthRequest, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
    const sessions = await ariaService.getEmployeeSessions(req.employee!.id, limit);
    res.json({ success: true, data: sessions });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /aria/sessions/:sessionId/close - Cerrar sesión
router.post('/aria/sessions/:sessionId/close', authMiddleware, requirePermission('aria:use'), async (req: AuthRequest, res) => {
  try {
    await ariaService.closeSession(req.params.sessionId);
    res.json({ success: true, message: 'Sesión cerrada' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /aria/decisions/:decisionId/rollback - Rollback de decisión
router.post('/aria/decisions/:decisionId/rollback', authMiddleware, requirePermission('aria:use'), async (req: AuthRequest, res) => {
  try {
    const { reason } = req.body;
    
    if (!reason) {
      return res.status(400).json({ success: false, error: 'reason es requerido' });
    }
    
    const result = await ariaService.rollback(
      req.params.decisionId,
      req.employee!.id,
      reason
    );
    
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    
    res.json({ success: true, message: 'Rollback ejecutado' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// APPROVALS - DOBLE AUTORIZACIÓN
// ============================================

// POST /approvals - Crear solicitud
router.post('/approvals', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { resourceType, resourceId, operationType, payload, amount, reason } = req.body;
    
    if (!resourceType || !resourceId || !operationType || !payload) {
      return res.status(400).json({ 
        success: false, 
        error: 'resourceType, resourceId, operationType y payload son requeridos' 
      });
    }
    
    const request = await approvalService.createRequest({
      resourceType,
      resourceId,
      operationType,
      makerId: req.employee!.id,
      payload,
      amount,
      reason
    });
    
    res.status(201).json({ success: true, data: request });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// GET /approvals/pending - Solicitudes pendientes para el checker
router.get('/approvals/pending', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const requests = await approvalService.getRequestsForChecker(req.employee!.id, limit);
    res.json({ success: true, data: requests });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /approvals/my-requests - Mis solicitudes
router.get('/approvals/my-requests', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const requests = await approvalService.getPendingRequests({
      makerId: req.employee!.id
    });
    res.json({ success: true, data: requests });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /approvals/:id - Obtener solicitud
router.get('/approvals/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const request = await approvalService.getRequestById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, error: 'Solicitud no encontrada' });
    }
    res.json({ success: true, data: request });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /approvals/:id/decide - Aprobar/Rechazar
router.post('/approvals/:id/decide', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { decision, comments } = req.body;
    
    if (!decision || !['APPROVE', 'REJECT', 'REQUEST_CHANGES'].includes(decision)) {
      return res.status(400).json({ 
        success: false, 
        error: 'decision debe ser APPROVE, REJECT o REQUEST_CHANGES' 
      });
    }
    
    const result = await approvalService.processDecision({
      requestId: req.params.id,
      checkerId: req.employee!.id,
      decision,
      comments,
      ipAddress: req.ip
    });
    
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// GET /approvals/history - Historial
router.get('/approvals/history', authMiddleware, requirePermission('audit:read'), async (req: AuthRequest, res) => {
  try {
    const { resourceType, status, makerId, checkerId, dateFrom, dateTo, page, limit } = req.query;
    
    const result = await approvalService.getHistory({
      resourceType: resourceType as string,
      status: status as string,
      makerId: makerId as string,
      checkerId: checkerId as string,
      dateFrom: dateFrom ? new Date(dateFrom as string) : undefined,
      dateTo: dateTo ? new Date(dateTo as string) : undefined,
      page: page ? parseInt(page as string) : 1,
      limit: limit ? parseInt(limit as string) : 20
    });
    
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// SESSIONS - GESTIÓN DE SESIONES
// ============================================

// GET /sessions - Mis sesiones activas
router.get('/sessions', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const sessions = await sessionService.getEmployeeSessions(req.employee!.id);
    res.json({ success: true, data: sessions });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /sessions/:sessionId - Cerrar sesión específica
router.delete('/sessions/:sessionId', authMiddleware, async (req: AuthRequest, res) => {
  try {
    await sessionService.revokeSession(req.params.sessionId, 'User logout');
    res.json({ success: true, message: 'Sesión cerrada' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /sessions - Cerrar todas las sesiones
router.delete('/sessions', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { exceptCurrent } = req.query;
    // TODO: Obtener sessionId actual del token
    await sessionService.revokeAllSessions(req.employee!.id);
    res.json({ success: true, message: 'Todas las sesiones cerradas' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /auth/refresh - Refresh token
router.post('/auth/refresh', async (req: any, res: any) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({ success: false, error: 'refreshToken es requerido' });
    }
    
    const tokens = await sessionService.refreshTokens(refreshToken);
    res.json({ success: true, data: tokens });
  } catch (error: any) {
    res.status(401).json({ success: false, error: error.message });
  }
});

// POST /auth/change-password - Cambiar contraseña
router.post('/auth/change-password', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ 
        success: false, 
        error: 'currentPassword y newPassword son requeridos' 
      });
    }
    
    await sessionService.changePassword(req.employee!.id, currentPassword, newPassword);
    res.json({ success: true, message: 'Contraseña actualizada. Por seguridad, inicia sesión nuevamente.' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// POST /employees/:id/force-password-change - Forzar cambio de contraseña
router.post('/employees/:id/force-password-change', authMiddleware, requirePermission('employees:update'), async (req: AuthRequest, res) => {
  try {
    await sessionService.forcePasswordChange(req.params.id, req.employee!.id);
    res.json({ success: true, message: 'El empleado deberá cambiar su contraseña en el próximo login' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /employees/:id/reset-password - Reset de contraseña (admin)
router.post('/employees/:id/reset-password', authMiddleware, requirePermission('employees:update'), async (req: AuthRequest, res) => {
  try {
    const { newPassword } = req.body;
    
    if (!newPassword) {
      return res.status(400).json({ success: false, error: 'newPassword es requerido' });
    }
    
    await sessionService.resetPassword(req.params.id, newPassword, req.employee!.id);
    res.json({ success: true, message: 'Contraseña reseteada. El empleado deberá cambiarla en el próximo login.' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ============================================
// TICKETS
// ============================================

// POST /tickets - Crear ticket
router.post('/tickets', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { userId, subject, description, category, priority, attachments } = req.body;
    
    if (!subject || !description) {
      return res.status(400).json({ success: false, error: 'subject y description son requeridos' });
    }
    
    const ticket = await ticketService.createTicket({
      userId,
      employeeId: req.employee!.id,
      subject,
      description,
      category,
      priority,
      attachments
    });
    
    res.status(201).json({ success: true, data: ticket });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /tickets - Listar tickets
router.get('/tickets', authMiddleware, requirePermission('tickets:view'), async (req: AuthRequest, res) => {
  try {
    const { status, priority, category, assignedTeam, assignedTo, userId, page, limit } = req.query;
    
    const result = await ticketService.getTickets({
      status: status as string,
      priority: priority as string,
      category: category as string,
      assignedTeam: assignedTeam as string,
      assignedTo: assignedTo as string,
      userId: userId as string,
      page: page ? parseInt(page as string) : 1,
      limit: limit ? parseInt(limit as string) : 20
    });
    
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /tickets/stats - Estadísticas
router.get('/tickets/stats', authMiddleware, requirePermission('tickets:view'), async (req: AuthRequest, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const stats = await ticketService.getStats(
      dateFrom ? new Date(dateFrom as string) : undefined,
      dateTo ? new Date(dateTo as string) : undefined
    );
    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /tickets/:id - Obtener ticket
router.get('/tickets/:id', authMiddleware, requirePermission('tickets:view'), async (req: AuthRequest, res) => {
  try {
    const ticket = await ticketService.getTicketById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, error: 'Ticket no encontrado' });
    }
    res.json({ success: true, data: ticket });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PATCH /tickets/:id - Actualizar ticket
router.patch('/tickets/:id', authMiddleware, requirePermission('tickets:update'), async (req: AuthRequest, res) => {
  try {
    const { status, priority, assignedTo, assignedTeam } = req.body;
    const ticket = await ticketService.updateTicket(req.params.id, {
      status, priority, assignedTo, assignedTeam
    }, req.employee!.id);
    res.json({ success: true, data: ticket });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /tickets/:id/messages - Agregar mensaje
router.post('/tickets/:id/messages', authMiddleware, requirePermission('tickets:update'), async (req: AuthRequest, res) => {
  try {
    const { content, isInternal, attachments } = req.body;
    
    if (!content) {
      return res.status(400).json({ success: false, error: 'content es requerido' });
    }
    
    const message = await ticketService.addMessage(req.params.id, {
      senderId: req.employee!.id,
      senderType: 'employee',
      content,
      isInternal,
      attachments
    });
    
    res.status(201).json({ success: true, data: message });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /tickets/:id/aria-respond - Que Aria responda
router.post('/tickets/:id/aria-respond', authMiddleware, requirePermission('aria:use'), async (req: AuthRequest, res) => {
  try {
    const result = await ticketService.letAriaRespond(req.params.id, req.employee!.id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /tickets/:id/close - Cerrar ticket
router.post('/tickets/:id/close', authMiddleware, requirePermission('tickets:update'), async (req: AuthRequest, res) => {
  try {
    const { resolution } = req.body;
    const ticket = await ticketService.closeTicket(req.params.id, req.employee!.id, resolution);
    res.json({ success: true, data: ticket });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// PROVIDERS
// ============================================

// GET /providers - Listar todos los proveedores
router.get('/providers', authMiddleware, requirePermission('providers:view'), async (req: AuthRequest, res) => {
  try {
    const providers = await providerService.getProviders();
    res.json({ success: true, data: providers });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /providers/definitions - Definiciones disponibles
router.get('/providers/definitions', authMiddleware, requirePermission('providers:view'), async (req: AuthRequest, res) => {
  res.json({ success: true, data: PROVIDER_DEFINITIONS });
});

// GET /providers/:slug - Obtener proveedor
router.get('/providers/:slug', authMiddleware, requirePermission('providers:view'), async (req: AuthRequest, res) => {
  try {
    const provider = await providerService.getProvider(req.params.slug);
    if (!provider) {
      return res.status(404).json({ success: false, error: 'Proveedor no encontrado' });
    }
    res.json({ success: true, data: provider });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /providers/:slug/configure - Configurar proveedor
router.post('/providers/:slug/configure', authMiddleware, requirePermission('providers:update'), async (req: AuthRequest, res) => {
  try {
    const { credentials, settings, webhookUrl } = req.body;
    
    if (!credentials) {
      return res.status(400).json({ success: false, error: 'credentials es requerido' });
    }
    
    const result = await providerService.configureProvider(req.params.slug, {
      credentials,
      settings,
      webhookUrl
    }, req.employee!.id);
    
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// POST /providers/:slug/activate - Activar proveedor
router.post('/providers/:slug/activate', authMiddleware, requirePermission('providers:update'), async (req: AuthRequest, res) => {
  try {
    await providerService.activateProvider(req.params.slug, req.employee!.id);
    res.json({ success: true, message: 'Proveedor activado' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// POST /providers/:slug/deactivate - Desactivar proveedor
router.post('/providers/:slug/deactivate', authMiddleware, requirePermission('providers:update'), async (req: AuthRequest, res) => {
  try {
    const { reason } = req.body;
    await providerService.deactivateProvider(req.params.slug, req.employee!.id, reason);
    res.json({ success: true, message: 'Proveedor desactivado' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /providers/:slug/health-check - Verificar salud
router.post('/providers/:slug/health-check', authMiddleware, requirePermission('providers:view'), async (req: AuthRequest, res) => {
  try {
    const result = await providerService.checkHealth(req.params.slug);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /providers/:slug/stats - Estadísticas del proveedor
router.get('/providers/:slug/stats', authMiddleware, requirePermission('providers:view'), async (req: AuthRequest, res) => {
  try {
    const days = req.query.days ? parseInt(req.query.days as string) : 7;
    const stats = await providerService.getProviderStats(req.params.slug, days);
    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /webhooks/:provider - Recibir webhook de proveedor
router.post('/webhooks/:provider', async (req: any, res: any) => {
  try {
    const signature = req.headers['x-signature'] || 
                      req.headers['stripe-signature'] || 
                      req.headers['x-webhook-signature'];
    
    const result = await providerService.processWebhook(
      req.params.provider,
      req.body,
      signature,
      req.headers
    );
    
    res.json(result);
  } catch (error: any) {
    console.error('Webhook error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

export default router;
