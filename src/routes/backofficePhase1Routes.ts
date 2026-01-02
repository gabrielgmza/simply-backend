import { Router } from 'express';
import { authMiddleware, requirePermission, AuthRequest } from '../middleware/auth';
import { systemSettingsService } from '../services/backoffice/systemSettingsService';
import { backofficeInvestmentService } from '../services/backoffice/backofficeInvestmentService';
import { backofficeFinancingService } from '../services/backoffice/backofficeFinancingService';
import { userDetailService } from '../services/backoffice/userDetailService';
import { auditLogService } from '../services/backoffice/auditLogService';

const router = Router();

// ============================================
// SYSTEM SETTINGS
// ============================================

// Obtener todas las configuraciones
router.get('/settings', authMiddleware, requirePermission('settings:read'), async (req: AuthRequest, res) => {
  try {
    const settings = await systemSettingsService.getAll();
    res.json({ success: true, data: settings });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Obtener configuraciones por categoría
router.get('/settings/category/:category', authMiddleware, requirePermission('settings:read'), async (req: AuthRequest, res) => {
  try {
    const settings = await systemSettingsService.getByCategory(req.params.category);
    res.json({ success: true, data: settings });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Obtener tasas actuales
router.get('/settings/rates', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const rates = await systemSettingsService.getCurrentRates();
    res.json({ success: true, data: rates });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Obtener feature flags
router.get('/settings/features', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const features = await systemSettingsService.getFeatureFlags();
    res.json({ success: true, data: features });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Actualizar configuración
router.put('/settings/:key', authMiddleware, requirePermission('settings:update'), async (req: AuthRequest, res) => {
  try {
    const { key } = req.params;
    const { value, reason } = req.body;

    if (value === undefined) {
      return res.status(400).json({ success: false, error: 'value es requerido' });
    }

    const updated = await systemSettingsService.set(
      key,
      value.toString(),
      req.employee!.id,
      req.employee!.email,
      reason
    );

    res.json({ success: true, data: updated, message: 'Configuración actualizada' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Actualizar múltiples configuraciones
router.put('/settings', authMiddleware, requirePermission('settings:update'), async (req: AuthRequest, res) => {
  try {
    const { updates, reason } = req.body;

    if (!Array.isArray(updates)) {
      return res.status(400).json({ success: false, error: 'updates debe ser un array' });
    }

    const results = await systemSettingsService.setMultiple(
      updates,
      req.employee!.id,
      req.employee!.email,
      reason
    );

    res.json({ success: true, data: results, message: `${results.length} configuraciones actualizadas` });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Simular impacto de cambio
router.post('/settings/:key/simulate', authMiddleware, requirePermission('settings:read'), async (req: AuthRequest, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    const impact = await systemSettingsService.simulateImpact(key, value.toString());
    res.json({ success: true, data: impact });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Historial de cambios
router.get('/settings/history', authMiddleware, requirePermission('settings:read'), async (req: AuthRequest, res) => {
  try {
    const { key, page, limit, dateFrom, dateTo } = req.query;

    const history = await systemSettingsService.getHistory({
      key: key as string,
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      dateFrom: dateFrom ? new Date(dateFrom as string) : undefined,
      dateTo: dateTo ? new Date(dateTo as string) : undefined
    });

    res.json({ success: true, data: history });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// INVESTMENTS MANAGEMENT
// ============================================

// Listar inversiones
router.get('/investments', authMiddleware, requirePermission('investments:read'), async (req: AuthRequest, res) => {
  try {
    const { page, limit, status, userId, minAmount, maxAmount, dateFrom, dateTo, sortBy, sortOrder } = req.query;

    const result = await backofficeInvestmentService.getAll({
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      status: status as string,
      userId: userId as string,
      minAmount: minAmount ? parseFloat(minAmount as string) : undefined,
      maxAmount: maxAmount ? parseFloat(maxAmount as string) : undefined,
      dateFrom: dateFrom ? new Date(dateFrom as string) : undefined,
      dateTo: dateTo ? new Date(dateTo as string) : undefined,
      sortBy: sortBy as string,
      sortOrder: sortOrder as 'asc' | 'desc'
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Obtener inversión por ID
router.get('/investments/:id', authMiddleware, requirePermission('investments:read'), async (req: AuthRequest, res) => {
  try {
    const investment = await backofficeInvestmentService.getById(req.params.id);
    res.json({ success: true, data: investment });
  } catch (error: any) {
    res.status(404).json({ success: false, error: error.message });
  }
});

// Estadísticas de inversiones
router.get('/investments/stats/overview', authMiddleware, requirePermission('investments:read'), async (req: AuthRequest, res) => {
  try {
    const stats = await backofficeInvestmentService.getStats();
    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Crear inversión manual
router.post('/investments', authMiddleware, requirePermission('investments:create'), async (req: AuthRequest, res) => {
  try {
    const { userId, amount, reason } = req.body;

    if (!userId || !amount || !reason) {
      return res.status(400).json({ success: false, error: 'userId, amount y reason son requeridos' });
    }

    const investment = await backofficeInvestmentService.createForUser(
      userId,
      amount,
      req.employee!.id,
      req.employee!.email,
      reason
    );

    res.status(201).json({ success: true, data: investment, message: 'Inversión creada' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Liquidar inversión forzada
router.post('/investments/:id/liquidate', authMiddleware, requirePermission('investments:liquidate'), async (req: AuthRequest, res) => {
  try {
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ success: false, error: 'reason es requerido' });
    }

    const result = await backofficeInvestmentService.forceLiquidate(
      req.params.id,
      req.employee!.id,
      req.employee!.email,
      reason
    );

    res.json({ success: true, data: result, message: 'Inversión liquidada' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Ajustar valor de inversión
router.patch('/investments/:id/value', authMiddleware, requirePermission('investments:update'), async (req: AuthRequest, res) => {
  try {
    const { value, reason } = req.body;

    if (!value || !reason) {
      return res.status(400).json({ success: false, error: 'value y reason son requeridos' });
    }

    const investment = await backofficeInvestmentService.adjustValue(
      req.params.id,
      value,
      req.employee!.id,
      req.employee!.email,
      reason
    );

    res.json({ success: true, data: investment, message: 'Valor ajustado' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Exportar inversiones
router.get('/investments/export/csv', authMiddleware, requirePermission('investments:read'), async (req: AuthRequest, res) => {
  try {
    const { headers, rows } = await backofficeInvestmentService.exportToCSV();
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=inversiones-${Date.now()}.csv`);
    res.send('\uFEFF' + csv);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// FINANCING MANAGEMENT
// ============================================

// Listar financiaciones
router.get('/financings', authMiddleware, requirePermission('financings:read'), async (req: AuthRequest, res) => {
  try {
    const { page, limit, status, userId, investmentId, hasOverdue, minAmount, maxAmount, dateFrom, dateTo, sortBy, sortOrder } = req.query;

    const result = await backofficeFinancingService.getAll({
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      status: status as string,
      userId: userId as string,
      investmentId: investmentId as string,
      hasOverdue: hasOverdue === 'true',
      minAmount: minAmount ? parseFloat(minAmount as string) : undefined,
      maxAmount: maxAmount ? parseFloat(maxAmount as string) : undefined,
      dateFrom: dateFrom ? new Date(dateFrom as string) : undefined,
      dateTo: dateTo ? new Date(dateTo as string) : undefined,
      sortBy: sortBy as string,
      sortOrder: sortOrder as 'asc' | 'desc'
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Obtener financiación por ID
router.get('/financings/:id', authMiddleware, requirePermission('financings:read'), async (req: AuthRequest, res) => {
  try {
    const financing = await backofficeFinancingService.getById(req.params.id);
    res.json({ success: true, data: financing });
  } catch (error: any) {
    res.status(404).json({ success: false, error: error.message });
  }
});

// Estadísticas de financiaciones
router.get('/financings/stats/overview', authMiddleware, requirePermission('financings:read'), async (req: AuthRequest, res) => {
  try {
    const stats = await backofficeFinancingService.getStats();
    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Cuotas por vencer
router.get('/financings/upcoming', authMiddleware, requirePermission('financings:read'), async (req: AuthRequest, res) => {
  try {
    const days = req.query.days ? parseInt(req.query.days as string) : 7;
    const installments = await backofficeFinancingService.getUpcomingDue(days);
    res.json({ success: true, data: installments });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Pagar cuota manual
router.post('/financings/installments/:id/pay', authMiddleware, requirePermission('financings:pay'), async (req: AuthRequest, res) => {
  try {
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ success: false, error: 'reason es requerido' });
    }

    const result = await backofficeFinancingService.payInstallmentManual(
      req.params.id,
      req.employee!.id,
      req.employee!.email,
      reason
    );

    res.json({ success: true, data: result, message: 'Cuota pagada' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Liquidar financiación forzada
router.post('/financings/:id/liquidate', authMiddleware, requirePermission('financings:liquidate'), async (req: AuthRequest, res) => {
  try {
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ success: false, error: 'reason es requerido' });
    }

    const result = await backofficeFinancingService.forceLiquidate(
      req.params.id,
      req.employee!.id,
      req.employee!.email,
      reason
    );

    res.json({ success: true, data: result, message: 'Financiación liquidada' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Condonar penalización
router.post('/financings/installments/:id/waive', authMiddleware, requirePermission('financings:waive'), async (req: AuthRequest, res) => {
  try {
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ success: false, error: 'reason es requerido' });
    }

    const result = await backofficeFinancingService.waivePenalty(
      req.params.id,
      req.employee!.id,
      req.employee!.email,
      reason
    );

    res.json({ success: true, data: result, message: 'Penalización condonada' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Extender vencimiento
router.post('/financings/installments/:id/extend', authMiddleware, requirePermission('financings:update'), async (req: AuthRequest, res) => {
  try {
    const { newDueDate, reason } = req.body;

    if (!newDueDate || !reason) {
      return res.status(400).json({ success: false, error: 'newDueDate y reason son requeridos' });
    }

    const result = await backofficeFinancingService.extendDueDate(
      req.params.id,
      new Date(newDueDate),
      req.employee!.id,
      req.employee!.email,
      reason
    );

    res.json({ success: true, data: result, message: 'Vencimiento extendido' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Exportar financiaciones
router.get('/financings/export/csv', authMiddleware, requirePermission('financings:read'), async (req: AuthRequest, res) => {
  try {
    const { headers, rows } = await backofficeFinancingService.exportToCSV();
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=financiaciones-${Date.now()}.csv`);
    res.send('\uFEFF' + csv);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// USER DETAIL (Vista completa)
// ============================================

// Obtener perfil completo de usuario
router.get('/users/:id/full', authMiddleware, requirePermission('users:read'), async (req: AuthRequest, res) => {
  try {
    const profile = await userDetailService.getFullProfile(req.params.id);
    res.json({ success: true, data: profile });
  } catch (error: any) {
    res.status(404).json({ success: false, error: error.message });
  }
});

// Historial de transacciones
router.get('/users/:id/transactions', authMiddleware, requirePermission('users:read'), async (req: AuthRequest, res) => {
  try {
    const { page, limit, type, dateFrom, dateTo } = req.query;

    const history = await userDetailService.getTransactionHistory(req.params.id, {
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      type: type as string,
      dateFrom: dateFrom ? new Date(dateFrom as string) : undefined,
      dateTo: dateTo ? new Date(dateTo as string) : undefined
    });

    res.json({ success: true, data: history });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Bloquear usuario
router.post('/users/:id/block', authMiddleware, requirePermission('users:block'), async (req: AuthRequest, res) => {
  try {
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ success: false, error: 'reason es requerido' });
    }

    const result = await userDetailService.blockUser(
      req.params.id,
      reason,
      req.employee!.id,
      req.employee!.email
    );

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Desbloquear usuario
router.post('/users/:id/unblock', authMiddleware, requirePermission('users:block'), async (req: AuthRequest, res) => {
  try {
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ success: false, error: 'reason es requerido' });
    }

    const result = await userDetailService.unblockUser(
      req.params.id,
      reason,
      req.employee!.id,
      req.employee!.email
    );

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Ajustar límites
router.patch('/users/:id/limits', authMiddleware, requirePermission('users:update'), async (req: AuthRequest, res) => {
  try {
    const { dailyLimit, monthlyLimit, reason } = req.body;

    if (!reason) {
      return res.status(400).json({ success: false, error: 'reason es requerido' });
    }

    const result = await userDetailService.adjustLimits(
      req.params.id,
      { dailyLimit, monthlyLimit },
      req.employee!.id,
      req.employee!.email,
      reason
    );

    res.json({ success: true, data: result, message: 'Límites ajustados' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Cambiar nivel de usuario
router.patch('/users/:id/level', authMiddleware, requirePermission('users:update'), async (req: AuthRequest, res) => {
  try {
    const { level, reason } = req.body;

    if (!level || !reason) {
      return res.status(400).json({ success: false, error: 'level y reason son requeridos' });
    }

    const result = await userDetailService.updateUserLevel(
      req.params.id,
      level,
      req.employee!.id,
      req.employee!.email,
      reason
    );

    res.json({ success: true, data: result, message: 'Nivel actualizado' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Agregar flag de riesgo
router.post('/users/:id/risk-flags', authMiddleware, requirePermission('users:risk'), async (req: AuthRequest, res) => {
  try {
    const { type, severity, description, details } = req.body;

    if (!type || !severity || !description) {
      return res.status(400).json({ success: false, error: 'type, severity y description son requeridos' });
    }

    const flag = await userDetailService.addRiskFlag(
      req.params.id,
      { type, severity, description, details },
      req.employee!.id,
      req.employee!.email
    );

    res.status(201).json({ success: true, data: flag, message: 'Flag agregado' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Resolver flag de riesgo
router.post('/risk-flags/:id/resolve', authMiddleware, requirePermission('users:risk'), async (req: AuthRequest, res) => {
  try {
    const { resolution } = req.body;

    if (!resolution) {
      return res.status(400).json({ success: false, error: 'resolution es requerido' });
    }

    const flag = await userDetailService.resolveRiskFlag(
      req.params.id,
      resolution,
      req.employee!.id,
      req.employee!.email
    );

    res.json({ success: true, data: flag, message: 'Flag resuelto' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Historial de auditoría del usuario
router.get('/users/:id/audit', authMiddleware, requirePermission('users:read'), async (req: AuthRequest, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const history = await userDetailService.getAuditHistory(req.params.id, limit);
    res.json({ success: true, data: history });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// AUDIT LOGS
// ============================================

// Obtener logs de auditoría
router.get('/audit', authMiddleware, requirePermission('audit:read'), async (req: AuthRequest, res) => {
  try {
    const { page, limit, actorType, actorId, action, resource, resourceId, dateFrom, dateTo, status } = req.query;

    const logs = await auditLogService.getAll({
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      actorType: actorType as string,
      actorId: actorId as string,
      action: action as string,
      resource: resource as string,
      resourceId: resourceId as string,
      dateFrom: dateFrom ? new Date(dateFrom as string) : undefined,
      dateTo: dateTo ? new Date(dateTo as string) : undefined,
      status: status as string
    });

    res.json({ success: true, data: logs });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Estadísticas de auditoría
router.get('/audit/stats', authMiddleware, requirePermission('audit:read'), async (req: AuthRequest, res) => {
  try {
    const days = req.query.days ? parseInt(req.query.days as string) : 7;
    const stats = await auditLogService.getStats(days);
    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Logs recientes
router.get('/audit/recent', authMiddleware, requirePermission('audit:read'), async (req: AuthRequest, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const logs = await auditLogService.getRecent(limit);
    res.json({ success: true, data: logs });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
