import { Router, Request, Response } from 'express';
import { trustScoreService } from '../services/security/trustScoreService';
import { riskBasedAuthService } from '../services/security/riskBasedAuthService';
import { deviceFingerprintService } from '../services/security/deviceFingerprintService';
import { killSwitchService } from '../services/security/killSwitchService';
import { employeeAnomalyService } from '../services/security/employeeAnomalyService';
import { behavioralAnalyticsService } from '../services/security/behavioralAnalyticsService';
import { enhancedFraudService } from '../services/security/enhancedFraudService';
import { realTimeAlertingService } from '../services/security/realTimeAlertingService';

const router = Router();

// ==========================================
// MIDDLEWARE DE AUTENTICACIÓN
// ==========================================

const requireAuth = (req: Request, res: Response, next: Function) => {
  // TODO: Verificar JWT
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  (req as any).userId = userId;
  next();
};

const requireEmployee = (req: Request, res: Response, next: Function) => {
  const employeeId = req.headers['x-employee-id'] as string;
  const role = req.headers['x-employee-role'] as string;
  if (!employeeId) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  (req as any).employeeId = employeeId;
  (req as any).employeeRole = role;
  next();
};

const requireAdmin = (req: Request, res: Response, next: Function) => {
  const role = req.headers['x-employee-role'] as string;
  if (!['SUPER_ADMIN', 'ADMIN'].includes(role)) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  next();
};

// ==========================================
// TRUST SCORE (Usuario)
// ==========================================

// GET /api/security/trust-score
router.get('/trust-score', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const score = await trustScoreService.getScore(userId);
    
    // No exponer todos los detalles al usuario
    res.json({
      score: score.globalScore,
      tier: score.tier,
      benefits: score.benefits,
      trend: score.trend,
      nextReviewDate: score.nextReviewDate
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/security/trust-score/history
router.get('/trust-score/history', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const limit = parseInt(req.query.limit as string) || 30;
    const history = await trustScoreService.getScoreHistory(userId, limit);
    res.json(history);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// TRUST SCORE (Backoffice)
// ==========================================

// GET /api/backoffice/security/trust-score/:userId
router.get('/backoffice/trust-score/:userId', requireEmployee, async (req: Request, res: Response) => {
  try {
    const score = await trustScoreService.getScore(req.params.userId);
    res.json(score); // Full details para backoffice
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/backoffice/security/trust-score/:userId/recalculate
router.post('/backoffice/trust-score/:userId/recalculate', requireEmployee, async (req: Request, res: Response) => {
  try {
    const score = await trustScoreService.forceRecalculate(req.params.userId);
    res.json(score);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// RISK-BASED AUTH
// ==========================================

// POST /api/security/risk-assess
router.post('/risk-assess', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { operation, amount, destinationCvu, deviceFingerprint, geoLocation } = req.body;
    
    const assessment = await riskBasedAuthService.assessRisk({
      userId,
      operation,
      amount,
      destinationCvu,
      deviceFingerprint,
      ipAddress: req.ip || req.headers['x-forwarded-for'] as string || 'unknown',
      userAgent: req.headers['user-agent'] || '',
      geoLocation,
      sessionId: req.headers['x-session-id'] as string || 'unknown'
    });

    res.json({
      riskScore: assessment.riskScore,
      riskLevel: assessment.riskLevel,
      requiredAction: assessment.requiredAction,
      userMessage: assessment.userMessage,
      cooldownMinutes: assessment.cooldownMinutes
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/security/verify-challenge
router.post('/verify-challenge', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const sessionId = req.headers['x-session-id'] as string;
    const { challengeType, response } = req.body;

    const result = await riskBasedAuthService.verifyChallenge(
      userId,
      sessionId,
      challengeType,
      response
    );

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// DEVICE FINGERPRINTING
// ==========================================

// POST /api/security/devices/register
router.post('/devices/register', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const fingerprintData = req.body;
    const ipAddress = req.ip || req.headers['x-forwarded-for'] as string || 'unknown';

    const device = await deviceFingerprintService.registerDevice(userId, fingerprintData, ipAddress);
    res.json(device);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/security/devices
router.get('/devices', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const devices = await deviceFingerprintService.getUserDevices(userId);
    res.json(devices);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/security/devices/:deviceId/trust
router.post('/devices/:deviceId/trust', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const device = await deviceFingerprintService.trustDevice(userId, req.params.deviceId);
    res.json(device);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/security/devices/:deviceId/block
router.post('/devices/:deviceId/block', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { reason } = req.body;
    const device = await deviceFingerprintService.blockDevice(userId, req.params.deviceId, reason);
    res.json(device);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/security/devices/:deviceId
router.delete('/devices/:deviceId', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    await deviceFingerprintService.removeDevice(userId, req.params.deviceId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// KILL SWITCH (Backoffice - Solo Admins)
// ==========================================

// GET /api/backoffice/kill-switch
router.get('/backoffice/kill-switch', requireEmployee, requireAdmin, async (req: Request, res: Response) => {
  try {
    const state = await killSwitchService.getState();
    res.json(state);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/backoffice/kill-switch/activate
router.post('/backoffice/kill-switch/activate', requireEmployee, requireAdmin, async (req: Request, res: Response) => {
  try {
    const employeeId = (req as any).employeeId;
    const { scope, target, reason, expiresInMinutes } = req.body;

    const state = await killSwitchService.activate({
      scope,
      target,
      reason,
      activatedBy: employeeId,
      expiresInMinutes
    });

    res.json(state);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/backoffice/kill-switch/deactivate
router.post('/backoffice/kill-switch/deactivate', requireEmployee, requireAdmin, async (req: Request, res: Response) => {
  try {
    const employeeId = (req as any).employeeId;
    const { scope, target, reason } = req.body;

    const state = await killSwitchService.deactivate({
      scope,
      target,
      deactivatedBy: employeeId,
      reason
    });

    res.json(state);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/backoffice/kill-switch/maintenance
router.post('/backoffice/kill-switch/maintenance', requireEmployee, requireAdmin, async (req: Request, res: Response) => {
  try {
    const employeeId = (req as any).employeeId;
    const { activate, reason, estimatedDurationMinutes } = req.body;

    let state;
    if (activate) {
      state = await killSwitchService.activateMaintenance({
        activatedBy: employeeId,
        reason,
        estimatedDurationMinutes
      });
    } else {
      state = await killSwitchService.deactivateMaintenance(employeeId);
    }

    res.json(state);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/backoffice/kill-switch/stats
router.get('/backoffice/kill-switch/stats', requireEmployee, async (req: Request, res: Response) => {
  try {
    const stats = await killSwitchService.getStats();
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// EMPLOYEE ANOMALY DETECTION (Backoffice)
// ==========================================

// GET /api/backoffice/anomalies
router.get('/backoffice/anomalies', requireEmployee, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { employeeId, status, severity, from, to, limit } = req.query;
    
    const anomalies = await employeeAnomalyService.getAnomalies({
      employeeId: employeeId as string,
      status: status as string,
      severity: severity as string,
      from: from ? new Date(from as string) : undefined,
      to: to ? new Date(to as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined
    });

    res.json(anomalies);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/backoffice/anomalies/:anomalyId
router.patch('/backoffice/anomalies/:anomalyId', requireEmployee, requireAdmin, async (req: Request, res: Response) => {
  try {
    const employeeId = (req as any).employeeId;
    const { status } = req.body;

    const anomaly = await employeeAnomalyService.updateAnomalyStatus(
      req.params.anomalyId,
      status,
      employeeId
    );

    res.json(anomaly);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// BEHAVIORAL ANALYTICS (Backoffice)
// ==========================================

// GET /api/backoffice/behavior/:userId
router.get('/backoffice/behavior/:userId', requireEmployee, async (req: Request, res: Response) => {
  try {
    let profile = await behavioralAnalyticsService.getProfile(req.params.userId);
    
    if (!profile) {
      profile = await behavioralAnalyticsService.buildProfile(req.params.userId);
    }

    res.json(profile);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/backoffice/behavior/:userId/rebuild
router.post('/backoffice/behavior/:userId/rebuild', requireEmployee, async (req: Request, res: Response) => {
  try {
    const profile = await behavioralAnalyticsService.buildProfile(req.params.userId);
    res.json(profile);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// FRAUD DETECTION
// ==========================================

// POST /api/security/fraud/evaluate (Internal - llamado por otros servicios)
router.post('/fraud/evaluate', async (req: Request, res: Response) => {
  try {
    // Solo permitir llamadas internas
    const internalKey = req.headers['x-internal-key'];
    if (internalKey !== process.env.INTERNAL_API_KEY) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const context = req.body;
    const evaluation = await enhancedFraudService.evaluateTransaction(context);
    res.json(evaluation);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/backoffice/fraud/evaluations
router.get('/backoffice/fraud/evaluations', requireEmployee, async (req: Request, res: Response) => {
  try {
    const { userId, riskLevel, decision, from, to, limit } = req.query;
    
    // TODO: Implementar query de evaluaciones
    res.json({ message: 'Not implemented' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// REAL-TIME ALERTS (Backoffice)
// ==========================================

// GET /api/backoffice/alerts
router.get('/backoffice/alerts', requireEmployee, async (req: Request, res: Response) => {
  try {
    const employeeId = (req as any).employeeId;
    const employeeRole = (req as any).employeeRole;
    const { category, priority, status, limit } = req.query;

    const alerts = await realTimeAlertingService.getAlerts({
      targetType: 'EMPLOYEE',
      targetId: employeeId,
      category: category as any,
      priority: priority as any,
      status: status as string,
      limit: limit ? parseInt(limit as string) : undefined
    });

    res.json(alerts);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/backoffice/alerts/unread-count
router.get('/backoffice/alerts/unread-count', requireEmployee, async (req: Request, res: Response) => {
  try {
    const employeeId = (req as any).employeeId;
    const count = await realTimeAlertingService.getUnreadCount('EMPLOYEE', employeeId);
    res.json({ count });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/backoffice/alerts/:alertId/read
router.post('/backoffice/alerts/:alertId/read', requireEmployee, async (req: Request, res: Response) => {
  try {
    const employeeId = (req as any).employeeId;
    await realTimeAlertingService.markAsRead(req.params.alertId, employeeId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/backoffice/alerts/:alertId/action
router.post('/backoffice/alerts/:alertId/action', requireEmployee, async (req: Request, res: Response) => {
  try {
    const employeeId = (req as any).employeeId;
    const { action } = req.body;
    await realTimeAlertingService.markAsActioned(req.params.alertId, employeeId, action);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/backoffice/alerts/stats
router.get('/backoffice/alerts/stats', requireEmployee, async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as 'day' | 'week' | 'month') || 'day';
    const stats = await realTimeAlertingService.getStats(period);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// USER ALERTS
// ==========================================

// GET /api/alerts
router.get('/alerts', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { limit } = req.query;

    const alerts = await realTimeAlertingService.getAlerts({
      targetType: 'USER',
      targetId: userId,
      limit: limit ? parseInt(limit as string) : 20
    });

    res.json(alerts);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// HEALTH CHECK
// ==========================================

// GET /api/security/health
router.get('/health', async (req: Request, res: Response) => {
  try {
    // Verificar kill switch
    const killSwitchState = await killSwitchService.getState();
    
    res.json({
      status: killSwitchState.globalKill ? 'DEGRADED' : 'HEALTHY',
      maintenanceMode: killSwitchState.maintenanceMode,
      activeKillSwitches: killSwitchState.activeKillSwitches.length,
      timestamp: new Date()
    });
  } catch (error: any) {
    res.status(500).json({ status: 'ERROR', error: error.message });
  }
});

export default router;
