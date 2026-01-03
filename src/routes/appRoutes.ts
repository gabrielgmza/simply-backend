import { Router } from 'express';
import { appAuthMiddleware, requireKYC, rateLimit, AppAuthRequest } from '../middleware/appAuth';
import { appAuthService } from '../services/app/appAuthService';
import { walletService } from '../services/app/walletService';
import { investmentService } from '../services/app/investmentService';
import { financingService } from '../services/app/financingService';
import { transferService, BCRA_MOTIVES } from '../services/app/transferService';

const router = Router();

// ============================================
// AUTH ENDPOINTS (Públicos)
// ============================================

// Registro
router.post('/auth/register', rateLimit(5, 15 * 60 * 1000), async (req, res) => {
  try {
    const { email, password, firstName, lastName, phone } = req.body;
    
    const result = await appAuthService.register({
      email, password, firstName, lastName, phone
    });
    
    res.status(201).json({
      success: true,
      data: result
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Login
router.post('/auth/login', rateLimit(10, 15 * 60 * 1000), async (req, res) => {
  try {
    const { email, password } = req.body;
    const deviceInfo = req.body.deviceInfo || req.headers['user-agent'];
    const ipAddress = req.ip || req.headers['x-forwarded-for'] as string;
    
    const result = await appAuthService.login({
      email, password, deviceInfo, ipAddress
    });
    
    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    res.status(401).json({
      success: false,
      error: error.message
    });
  }
});

// Refresh token
router.post('/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: 'Refresh token requerido'
      });
    }
    
    const result = await appAuthService.refreshTokens(refreshToken);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    res.status(401).json({
      success: false,
      error: error.message
    });
  }
});

// Logout
router.post('/auth/logout', appAuthMiddleware, async (req: AppAuthRequest, res) => {
  try {
    const { refreshToken } = req.body;
    
    await appAuthService.logout(req.user!.userId, refreshToken);
    
    res.json({
      success: true,
      message: 'Sesión cerrada correctamente'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// PROFILE ENDPOINTS
// ============================================

// Obtener perfil
router.get('/profile', appAuthMiddleware, async (req: AppAuthRequest, res) => {
  try {
    const profile = await appAuthService.getProfile(req.user!.userId);
    
    res.json({
      success: true,
      data: profile
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Actualizar perfil
router.put('/profile', appAuthMiddleware, async (req: AppAuthRequest, res) => {
  try {
    const { firstName, lastName, phone, fcmToken, preferences } = req.body;
    
    const profile = await appAuthService.updateProfile(req.user!.userId, {
      firstName, lastName, phone, fcmToken, preferences
    });
    
    res.json({
      success: true,
      data: profile
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Cambiar contraseña
router.post('/profile/change-password', appAuthMiddleware, async (req: AppAuthRequest, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    await appAuthService.changePassword(req.user!.userId, {
      currentPassword, newPassword
    });
    
    res.json({
      success: true,
      message: 'Contraseña actualizada correctamente'
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Obtener sesiones activas
router.get('/profile/sessions', appAuthMiddleware, async (req: AppAuthRequest, res) => {
  try {
    const sessions = await appAuthService.getActiveSessions(req.user!.userId);
    
    res.json({
      success: true,
      data: sessions
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Revocar sesión
router.delete('/profile/sessions/:sessionId', appAuthMiddleware, async (req: AppAuthRequest, res) => {
  try {
    await appAuthService.revokeSession(req.user!.userId, req.params.sessionId);
    
    res.json({
      success: true,
      message: 'Sesión revocada'
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// WALLET ENDPOINTS
// ============================================

// Obtener balance
router.get('/wallet/balance', appAuthMiddleware, requireKYC, async (req: AppAuthRequest, res) => {
  try {
    const balance = await walletService.getBalance(req.user!.userId);
    
    res.json({
      success: true,
      data: balance
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Obtener movimientos
router.get('/wallet/movements', appAuthMiddleware, requireKYC, async (req: AppAuthRequest, res) => {
  try {
    const { page, limit, type, dateFrom, dateTo } = req.query;
    
    const movements = await walletService.getMovements(req.user!.userId, {
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      type: type as string,
      dateFrom: dateFrom ? new Date(dateFrom as string) : undefined,
      dateTo: dateTo ? new Date(dateTo as string) : undefined
    });
    
    res.json({
      success: true,
      data: movements
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Actualizar alias
router.put('/wallet/alias', appAuthMiddleware, requireKYC, async (req: AppAuthRequest, res) => {
  try {
    const { alias } = req.body;
    
    const result = await walletService.updateAlias(req.user!.userId, alias);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// INVESTMENT ENDPOINTS
// ============================================

// Obtener inversiones
router.get('/investments', appAuthMiddleware, requireKYC, async (req: AppAuthRequest, res) => {
  try {
    const investments = await investmentService.getAll(req.user!.userId);
    
    res.json({
      success: true,
      data: investments
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Obtener inversión por ID
router.get('/investments/:id', appAuthMiddleware, requireKYC, async (req: AppAuthRequest, res) => {
  try {
    const investment = await investmentService.getById(req.user!.userId, req.params.id);
    
    res.json({
      success: true,
      data: investment
    });
  } catch (error: any) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

// Crear inversión
router.post('/investments', appAuthMiddleware, requireKYC, rateLimit(5, 60 * 1000), async (req: AppAuthRequest, res) => {
  try {
    const { amount } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Monto inválido'
      });
    }
    
    const investment = await investmentService.create(req.user!.userId, amount);
    
    res.status(201).json({
      success: true,
      data: investment,
      message: 'Inversión creada exitosamente'
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Liquidar inversión
router.post('/investments/:id/liquidate', appAuthMiddleware, requireKYC, async (req: AppAuthRequest, res) => {
  try {
    const result = await investmentService.liquidate(req.user!.userId, req.params.id);
    
    res.json({
      success: true,
      data: result,
      message: 'Inversión liquidada exitosamente'
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Obtener rendimientos de inversión
router.get('/investments/:id/returns', appAuthMiddleware, requireKYC, async (req: AppAuthRequest, res) => {
  try {
    const { page, limit, dateFrom, dateTo } = req.query;
    
    const returns = await investmentService.getReturns(req.user!.userId, req.params.id, {
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      dateFrom: dateFrom ? new Date(dateFrom as string) : undefined,
      dateTo: dateTo ? new Date(dateTo as string) : undefined
    });
    
    res.json({
      success: true,
      data: returns
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Simular inversión (público)
router.post('/investments/simulate', async (req, res) => {
  try {
    const { amount, months } = req.body;
    
    if (!amount || !months) {
      return res.status(400).json({
        success: false,
        error: 'Monto y meses son requeridos'
      });
    }
    
    const simulation = investmentService.simulate(amount, months);
    
    res.json({
      success: true,
      data: simulation
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// FINANCING ENDPOINTS
// ============================================

// Obtener financiaciones
router.get('/financing', appAuthMiddleware, requireKYC, async (req: AppAuthRequest, res) => {
  try {
    const financings = await financingService.getAll(req.user!.userId);
    
    res.json({
      success: true,
      data: financings
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Obtener financiación por ID
router.get('/financing/:id', appAuthMiddleware, requireKYC, async (req: AppAuthRequest, res) => {
  try {
    const financing = await financingService.getById(req.user!.userId, req.params.id);
    
    res.json({
      success: true,
      data: financing
    });
  } catch (error: any) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

// Crear financiación
router.post('/financing', appAuthMiddleware, requireKYC, rateLimit(5, 60 * 1000), async (req: AppAuthRequest, res) => {
  try {
    const { investmentId, amount, installments, destinationType, destinationRef, description } = req.body;
    
    const financing = await financingService.create(req.user!.userId, {
      investmentId, amount, installments, destinationType, destinationRef, description
    });
    
    res.status(201).json({
      success: true,
      data: financing,
      message: 'Financiación creada exitosamente'
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Simular financiación (público)
router.post('/financing/simulate', async (req, res) => {
  try {
    const { amount, installments } = req.body;
    
    if (!amount || !installments) {
      return res.status(400).json({
        success: false,
        error: 'Monto y cuotas son requeridos'
      });
    }
    
    const simulation = financingService.simulate(amount, installments);
    
    res.json({
      success: true,
      data: simulation
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Pagar cuota
router.post('/financing/installments/:id/pay', appAuthMiddleware, requireKYC, async (req: AppAuthRequest, res) => {
  try {
    const result = await financingService.payInstallment(req.user!.userId, req.params.id);
    
    res.json({
      success: true,
      data: result,
      message: 'Cuota pagada exitosamente'
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Caída de cuotas (drop)
router.post('/financing/:id/drop', appAuthMiddleware, requireKYC, async (req: AppAuthRequest, res) => {
  try {
    const result = await financingService.dropFinancing(req.user!.userId, req.params.id);
    
    res.json({
      success: true,
      data: result,
      message: 'Financiación terminada anticipadamente'
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// TRANSFER ENDPOINTS
// ============================================

// Transferir
router.post('/transfers', appAuthMiddleware, requireKYC, rateLimit(10, 60 * 1000), async (req: AppAuthRequest, res) => {
  try {
    const { destinationCVU, destinationAlias, amount, motive, reference } = req.body;
    
    const result = await transferService.transfer(req.user!.userId, {
      destinationCVU, destinationAlias, amount, motive, reference
    });
    
    res.status(201).json({
      success: true,
      data: result,
      message: 'Transferencia realizada'
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Validar destino
router.post('/transfers/validate', appAuthMiddleware, async (req: AppAuthRequest, res) => {
  try {
    const { identifier } = req.body;
    
    const result = await transferService.validateDestination(identifier);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Obtener motivos BCRA
router.get('/transfers/motives', async (req, res) => {
  res.json({
    success: true,
    data: BCRA_MOTIVES.map(code => ({
      code,
      description: {
        VAR: 'Varios',
        ALQ: 'Alquileres',
        CUO: 'Cuotas',
        EXP: 'Expensas',
        FAC: 'Facturas',
        PRE: 'Préstamos',
        SEG: 'Seguros',
        HON: 'Honorarios',
        HAB: 'Haberes',
        JUB: 'Jubilaciones'
      }[code]
    }))
  });
});

// ============================================
// CONTACTS ENDPOINTS
// ============================================

// Obtener contactos
router.get('/contacts', appAuthMiddleware, async (req: AppAuthRequest, res) => {
  try {
    const { search, favoritesOnly, limit } = req.query;
    
    const contacts = await transferService.getContacts(req.user!.userId, {
      search: search as string,
      favoritesOnly: favoritesOnly === 'true',
      limit: limit ? parseInt(limit as string) : undefined
    });
    
    res.json({
      success: true,
      data: contacts
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Guardar contacto
router.post('/contacts', appAuthMiddleware, async (req: AppAuthRequest, res) => {
  try {
    const { cvu, alias, name, isFavorite } = req.body;
    
    const contact = await transferService.saveContact(req.user!.userId, {
      cvu, alias, name, isFavorite
    });
    
    res.status(201).json({
      success: true,
      data: contact
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Eliminar contacto
router.delete('/contacts/:id', appAuthMiddleware, async (req: AppAuthRequest, res) => {
  try {
    await transferService.deleteContact(req.user!.userId, req.params.id);
    
    res.json({
      success: true,
      message: 'Contacto eliminado'
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Toggle favorito
router.post('/contacts/:id/favorite', appAuthMiddleware, async (req: AppAuthRequest, res) => {
  try {
    const contact = await transferService.toggleFavorite(req.user!.userId, req.params.id);
    
    res.json({
      success: true,
      data: contact
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
