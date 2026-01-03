import { Router } from 'express';
import { authMiddleware, requirePermission, AuthRequest } from '../middleware/auth';
import { dashboardService } from '../services/backoffice/dashboardService';
import { rewardsService } from '../services/backoffice/rewardsService';
import { systemSettingsService } from '../services/backoffice/systemSettingsService';

const router = Router();

// ============================================
// DASHBOARD ENDPOINTS
// ============================================

router.get('/dashboard/stats', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const stats = await dashboardService.getStats();
    res.json({ success: true, data: stats });
  } catch (error: any) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/dashboard/growth', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const data = await dashboardService.getGrowth(days);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/dashboard/activity', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const data = await dashboardService.getRecentActivity(limit);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/dashboard/performers', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const data = await dashboardService.getTopPerformers();
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// REWARDS ENDPOINTS
// ============================================

// Estadísticas globales
router.get('/rewards/stats', authMiddleware, requirePermission('rewards:read'), async (req: AuthRequest, res) => {
  try {
    const stats = await rewardsService.getStats();
    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Listar todos los rewards (admin)
router.get('/rewards', authMiddleware, requirePermission('rewards:read'), async (req: AuthRequest, res) => {
  try {
    const { page, limit, userId, type, status } = req.query;
    const data = await rewardsService.getAll({
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      userId: userId as string,
      type: type as string,
      status: status as string
    });
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Obtener rewards de un usuario
router.get('/rewards/user/:userId', authMiddleware, requirePermission('rewards:read'), async (req: AuthRequest, res) => {
  try {
    const balance = await rewardsService.getBalance(req.params.userId);
    const history = await rewardsService.getHistory(req.params.userId, { limit: 20 });
    res.json({ success: true, data: { balance, history: history.rewards } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Otorgar reward manual
router.post('/rewards/grant', authMiddleware, requirePermission('rewards:create'), async (req: AuthRequest, res) => {
  try {
    const { userId, type, points, amount, description } = req.body;
    
    if (!userId || !type || !description) {
      return res.status(400).json({ success: false, error: 'userId, type y description son requeridos' });
    }

    const reward = await rewardsService.grantManual({
      userId, type, points, amount, description,
      employeeId: req.employee!.id
    });

    res.status(201).json({ success: true, data: reward, message: 'Reward otorgado' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Canjear puntos
router.post('/rewards/redeem', authMiddleware, requirePermission('rewards:update'), async (req: AuthRequest, res) => {
  try {
    const { userId, points } = req.body;
    
    if (!userId || !points) {
      return res.status(400).json({ success: false, error: 'userId y points son requeridos' });
    }

    const result = await rewardsService.redeemPoints(userId, points, req.employee!.id);
    res.json({ success: true, data: result, message: 'Puntos canjeados' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Cancelar reward
router.post('/rewards/:id/cancel', authMiddleware, requirePermission('rewards:delete'), async (req: AuthRequest, res) => {
  try {
    const { reason } = req.body;
    if (!reason) {
      return res.status(400).json({ success: false, error: 'reason es requerido' });
    }

    const reward = await rewardsService.cancel(req.params.id, reason, req.employee!.id);
    res.json({ success: true, data: reward, message: 'Reward cancelado' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Expirar rewards vencidos (cron job)
router.post('/rewards/expire', authMiddleware, requirePermission('rewards:update'), async (req: AuthRequest, res) => {
  try {
    const count = await rewardsService.expireRewards();
    res.json({ success: true, data: { expiredCount: count } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ARIA GLOBAL CONFIG
// ============================================

// Obtener estado de Aria
router.get('/aria/config', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const enabled = await systemSettingsService.get('aria_enabled');
    const allowedRoles = await systemSettingsService.get('aria_allowed_roles');
    
    res.json({
      success: true,
      data: {
        enabled: enabled === 'true',
        allowedRoles: allowedRoles ? JSON.parse(allowedRoles) : ['SUPER_ADMIN', 'ADMIN', 'COMPLIANCE', 'SUPPORT', 'FINANCE', 'OPERATIONS', 'RISK', 'AUDITOR', 'ANALYST']
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Toggle Aria global (solo super admin)
router.post('/aria/toggle', authMiddleware, requirePermission('settings:update'), async (req: AuthRequest, res) => {
  try {
    const { enabled } = req.body;
    
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, error: 'enabled debe ser boolean' });
    }

    await systemSettingsService.set(
      'aria_enabled',
      enabled.toString(),
      req.employee!.id,
      req.employee!.email,
      `Aria ${enabled ? 'habilitada' : 'deshabilitada'} globalmente`
    );

    res.json({ success: true, data: { enabled }, message: `Aria ${enabled ? 'habilitada' : 'deshabilitada'}` });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Configurar roles permitidos para Aria
router.post('/aria/roles', authMiddleware, requirePermission('settings:update'), async (req: AuthRequest, res) => {
  try {
    const { roles } = req.body;
    
    if (!Array.isArray(roles)) {
      return res.status(400).json({ success: false, error: 'roles debe ser un array' });
    }

    await systemSettingsService.set(
      'aria_allowed_roles',
      JSON.stringify(roles),
      req.employee!.id,
      req.employee!.email,
      `Roles de Aria actualizados: ${roles.join(', ')}`
    );

    res.json({ success: true, data: { roles }, message: 'Roles actualizados' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

export default router;
