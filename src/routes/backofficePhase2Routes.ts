// ============================================
// BACKOFFICE PHASE 2 & 3 ROUTES
// Treasury, OTC, Fraud, Compliance
// Simply Backend v3.2.0
// ============================================

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { treasuryService } from '../services/backoffice/treasuryService';
import { otcService } from '../services/backoffice/otcService';
import { fraudService } from '../services/backoffice/fraudService';
import { complianceService } from '../services/backoffice/complianceService';

const router = Router();

// Middleware de autenticación para todas las rutas
router.use(authMiddleware);

// ============================================
// TREASURY ROUTES
// ============================================

// GET /treasury/accounts - Listar cuentas internas
router.get('/treasury/accounts', async (req: Request, res: Response) => {
  try {
    const accounts = await treasuryService.getAllAccounts();
    res.json({ success: true, data: accounts });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /treasury/accounts/:id - Obtener cuenta por ID
router.get('/treasury/accounts/:id', async (req: Request, res: Response) => {
  try {
    const account = await treasuryService.getAccountById(req.params.id);
    if (!account) {
      return res.status(404).json({ success: false, error: 'Cuenta no encontrada' });
    }
    res.json({ success: true, data: account });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /treasury/accounts/:id/movements - Movimientos de cuenta
router.get('/treasury/accounts/:id/movements', async (req: Request, res: Response) => {
  try {
    const { page, limit, type, from, to } = req.query;
    const result = await treasuryService.getAccountMovements(req.params.id, {
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      type: type as any,
      from: from ? new Date(from as string) : undefined,
      to: to ? new Date(to as string) : undefined,
    });
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /treasury/accounts - Crear cuenta interna
router.post('/treasury/accounts', async (req: Request, res: Response) => {
  try {
    const { name, type, currency, initialBalance } = req.body;
    const employeeId = (req as any).employee.id;
    
    const account = await treasuryService.createAccount(
      name, type, currency, employeeId, initialBalance
    );
    res.json({ success: true, data: account });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// POST /treasury/deposit - Depositar en cuenta
router.post('/treasury/deposit', async (req: Request, res: Response) => {
  try {
    const { accountId, amount, description, reference } = req.body;
    const employeeId = (req as any).employee.id;
    
    const movement = await treasuryService.deposit(
      accountId, amount, description, employeeId, reference
    );
    res.json({ success: true, data: movement });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// POST /treasury/withdraw - Retirar de cuenta
router.post('/treasury/withdraw', async (req: Request, res: Response) => {
  try {
    const { accountId, amount, description, reference } = req.body;
    const employeeId = (req as any).employee.id;
    
    const movement = await treasuryService.withdraw(
      accountId, amount, description, employeeId, reference
    );
    res.json({ success: true, data: movement });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// POST /treasury/transfer - Transferir entre cuentas
router.post('/treasury/transfer', async (req: Request, res: Response) => {
  try {
    const { fromAccountId, toAccountId, amount, description } = req.body;
    const employeeId = (req as any).employee.id;
    
    const result = await treasuryService.transferBetweenAccounts({
      fromAccountId, toAccountId, amount, description, employeeId
    });
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// POST /treasury/adjust - Ajustar saldo
router.post('/treasury/adjust', async (req: Request, res: Response) => {
  try {
    const { accountId, amount, reason } = req.body;
    const employeeId = (req as any).employee.id;
    
    const movement = await treasuryService.adjustBalance(
      accountId, amount, reason, employeeId
    );
    res.json({ success: true, data: movement });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// GET /treasury/summary - Resumen de tesorería
router.get('/treasury/summary', async (req: Request, res: Response) => {
  try {
    const summary = await treasuryService.getTreasurySummary();
    res.json({ success: true, data: summary });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /treasury/cashflow - Flujo de caja
router.get('/treasury/cashflow', async (req: Request, res: Response) => {
  try {
    const { from, to, currency } = req.query;
    const cashflow = await treasuryService.getCashFlow(
      from ? new Date(from as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      to ? new Date(to as string) : new Date(),
      currency as any
    );
    res.json({ success: true, data: cashflow });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /treasury/reconcile - Conciliar cuenta
router.post('/treasury/reconcile', async (req: Request, res: Response) => {
  try {
    const { accountId, expectedBalance } = req.body;
    const employeeId = (req as any).employee.id;
    
    const result = await treasuryService.reconcileAccount(
      accountId, expectedBalance, employeeId
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ============================================
// OTC ROUTES
// ============================================

// GET /otc/rates - Obtener cotizaciones
router.get('/otc/rates', async (req: Request, res: Response) => {
  try {
    const rates = await otcService.getCurrentRates();
    res.json({ success: true, data: rates });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /otc/quote - Obtener cotización para operación
router.post('/otc/quote', async (req: Request, res: Response) => {
  try {
    const { asset, type, amount } = req.body;
    const quote = await otcService.getQuote(asset, type, amount);
    res.json({ success: true, data: quote });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// GET /otc/operations - Listar operaciones
router.get('/otc/operations', async (req: Request, res: Response) => {
  try {
    const { page, limit, status, type, userId, from, to } = req.query;
    const result = await otcService.listOperations({
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      status: status as any,
      type: type as any,
      userId: userId as string,
      from: from ? new Date(from as string) : undefined,
      to: to ? new Date(to as string) : undefined,
    });
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /otc/operations - Crear operación
router.post('/otc/operations', async (req: Request, res: Response) => {
  try {
    const { userId, type, asset, amount, rate, totalARS, fee } = req.body;
    const employeeId = (req as any).employee.id;
    
    const operation = await otcService.createOperation({
      userId, type, asset, amount, rate, totalARS, fee
    }, employeeId);
    res.json({ success: true, data: operation });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// POST /otc/operations/:id/approve - Aprobar operación
router.post('/otc/operations/:id/approve', async (req: Request, res: Response) => {
  try {
    const employeeId = (req as any).employee.id;
    const operation = await otcService.approveOperation(req.params.id, employeeId);
    res.json({ success: true, data: operation });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// POST /otc/operations/:id/execute - Ejecutar operación
router.post('/otc/operations/:id/execute', async (req: Request, res: Response) => {
  try {
    const employeeId = (req as any).employee.id;
    const operation = await otcService.executeOperation(req.params.id, employeeId);
    res.json({ success: true, data: operation });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// POST /otc/operations/:id/reject - Rechazar operación
router.post('/otc/operations/:id/reject', async (req: Request, res: Response) => {
  try {
    const { reason } = req.body;
    const employeeId = (req as any).employee.id;
    const operation = await otcService.rejectOperation(req.params.id, employeeId, reason);
    res.json({ success: true, data: operation });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// GET /otc/stats - Estadísticas OTC
router.get('/otc/stats', async (req: Request, res: Response) => {
  try {
    const { days } = req.query;
    const stats = await otcService.getStats(days ? parseInt(days as string) : undefined);
    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// FRAUD ROUTES
// ============================================

// GET /fraud/alerts - Listar alertas
router.get('/fraud/alerts', async (req: Request, res: Response) => {
  try {
    const { page, limit, status, level, userId } = req.query;
    const result = await fraudService.listAlerts({
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      status: status as any,
      level: level as any,
      userId: userId as string,
    });
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /fraud/alerts/:id/review - Revisar alerta
router.post('/fraud/alerts/:id/review', async (req: Request, res: Response) => {
  try {
    const { resolution, notes } = req.body;
    const employeeId = (req as any).employee.id;
    
    const alert = await fraudService.reviewAlert(
      req.params.id, employeeId, resolution, notes
    );
    res.json({ success: true, data: alert });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// GET /fraud/stats - Estadísticas de fraude
router.get('/fraud/stats', async (req: Request, res: Response) => {
  try {
    const { days } = req.query;
    const stats = await fraudService.getStats(days ? parseInt(days as string) : undefined);
    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /fraud/blacklist/ip - Agregar IP a lista negra
router.post('/fraud/blacklist/ip', async (req: Request, res: Response) => {
  try {
    const { ip, reason } = req.body;
    const employeeId = (req as any).employee.id;
    
    const entry = await fraudService.blacklistIP(ip, reason, employeeId);
    res.json({ success: true, data: entry });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// DELETE /fraud/blacklist/ip/:ip - Remover IP de lista negra
router.delete('/fraud/blacklist/ip/:ip', async (req: Request, res: Response) => {
  try {
    const employeeId = (req as any).employee.id;
    await fraudService.removeIPFromBlacklist(req.params.ip, employeeId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ============================================
// COMPLIANCE ROUTES
// ============================================

// GET /compliance/reports - Listar reportes
router.get('/compliance/reports', async (req: Request, res: Response) => {
  try {
    const { page, limit, type, status, userId, from, to } = req.query;
    const result = await complianceService.listReports({
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      type: type as any,
      status: status as any,
      userId: userId as string,
      from: from ? new Date(from as string) : undefined,
      to: to ? new Date(to as string) : undefined,
    });
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /compliance/reports/ros - Generar ROS
router.post('/compliance/reports/ros', async (req: Request, res: Response) => {
  try {
    const { userId, transactionIds, type, description, amount, indicators } = req.body;
    const employeeId = (req as any).employee.id;
    
    const report = await complianceService.generateROS({
      userId, transactionIds, type, description, amount, indicators
    }, employeeId);
    res.json({ success: true, data: report });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// POST /compliance/reports/:id/approve - Aprobar reporte
router.post('/compliance/reports/:id/approve', async (req: Request, res: Response) => {
  try {
    const { notes } = req.body;
    const employeeId = (req as any).employee.id;
    
    const report = await complianceService.approveReport(req.params.id, employeeId, notes);
    res.json({ success: true, data: report });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// POST /compliance/reports/:id/submit - Enviar reporte a UIF
router.post('/compliance/reports/:id/submit', async (req: Request, res: Response) => {
  try {
    const employeeId = (req as any).employee.id;
    const report = await complianceService.submitReport(req.params.id, employeeId);
    res.json({ success: true, data: report });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// GET /compliance/thresholds - Verificar umbrales
router.get('/compliance/thresholds', async (req: Request, res: Response) => {
  try {
    const { date } = req.query;
    const result = await complianceService.checkThresholds(
      date ? new Date(date as string) : undefined
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /compliance/users/:id/status - Estado de compliance del usuario
router.get('/compliance/users/:id/status', async (req: Request, res: Response) => {
  try {
    const status = await complianceService.getUserComplianceStatus(req.params.id);
    res.json({ success: true, data: status });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// POST /compliance/reviews - Programar revisión
router.post('/compliance/reviews', async (req: Request, res: Response) => {
  try {
    const { userId, reason } = req.body;
    const employeeId = (req as any).employee.id;
    
    const review = await complianceService.scheduleUserReview(userId, reason, employeeId);
    res.json({ success: true, data: review });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// GET /compliance/reviews/pending - Revisiones pendientes
router.get('/compliance/reviews/pending', async (req: Request, res: Response) => {
  try {
    const { page, limit } = req.query;
    const result = await complianceService.listPendingReviews({
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
    });
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /compliance/stats - Estadísticas de compliance
router.get('/compliance/stats', async (req: Request, res: Response) => {
  try {
    const { days } = req.query;
    const stats = await complianceService.getComplianceStats(
      days ? parseInt(days as string) : undefined
    );
    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
