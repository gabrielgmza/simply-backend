import { Router, Request, Response } from 'express';
import { transferService, MOTIVOS_BCRA } from '../services/transferService';
import { contactsService } from '../services/contactsService';
import { accountService } from '../services/accountService';
import { pushNotificationService } from '../services/pushNotificationService';
import { mobileDashboardService } from '../services/mobileDashboardService';
import { onboardingService } from '../services/onboardingService';
import jwt from 'jsonwebtoken';

const router = Router();

// Middleware de autenticación para usuarios
interface AuthRequest extends Request {
  user?: { id: string; email: string };
}

const userAuthMiddleware = async (req: AuthRequest, res: Response, next: Function) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, error: 'Token requerido' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'simply-secret-key') as any;
    if (!decoded.userId || decoded.type !== 'user') {
      return res.status(401).json({ success: false, error: 'Token inválido' });
    }

    req.user = { id: decoded.userId, email: decoded.email };
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Token expirado o inválido' });
  }
};

// ============================================
// ONBOARDING / REGISTRO
// ============================================

// Iniciar registro
router.post('/register/start', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'Email requerido' });

    const result = await onboardingService.startRegistration(email);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Agregar teléfono
router.post('/register/phone', async (req, res) => {
  try {
    const { sessionId, phone } = req.body;
    if (!sessionId || !phone) {
      return res.status(400).json({ success: false, error: 'sessionId y phone requeridos' });
    }

    const result = await onboardingService.setPhone(sessionId, phone);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Verificar OTP
router.post('/register/verify-otp', async (req, res) => {
  try {
    const { sessionId, otp } = req.body;
    if (!sessionId || !otp) {
      return res.status(400).json({ success: false, error: 'sessionId y otp requeridos' });
    }

    const result = await onboardingService.verifyOTP(sessionId, otp);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Reenviar OTP
router.post('/register/resend-otp', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'sessionId requerido' });
    }

    const result = await onboardingService.resendOTP(sessionId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Establecer contraseña
router.post('/register/password', async (req, res) => {
  try {
    const { sessionId, password } = req.body;
    if (!sessionId || !password) {
      return res.status(400).json({ success: false, error: 'sessionId y password requeridos' });
    }

    const result = await onboardingService.setPassword(sessionId, password);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Datos personales
router.post('/register/personal', async (req, res) => {
  try {
    const { sessionId, ...personalData } = req.body;
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'sessionId requerido' });
    }

    const result = await onboardingService.setPersonalData(sessionId, personalData);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Iniciar KYC
router.post('/register/kyc', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'sessionId requerido' });
    }

    const result = await onboardingService.startKYC(sessionId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Completar registro
router.post('/register/complete', async (req, res) => {
  try {
    const { sessionId, kycApproved } = req.body;
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'sessionId requerido' });
    }

    const result = await onboardingService.completeRegistration(sessionId, kycApproved);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Estado de registro
router.get('/register/status/:sessionId', async (req, res) => {
  try {
    const result = await onboardingService.getRegistrationStatus(req.params.sessionId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ============================================
// DASHBOARD
// ============================================

router.get('/dashboard', userAuthMiddleware, async (req: AuthRequest, res) => {
  try {
    const data = await mobileDashboardService.getDashboard(req.user!.id);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/dashboard/quick', userAuthMiddleware, async (req: AuthRequest, res) => {
  try {
    const data = await mobileDashboardService.getQuickSummary(req.user!.id);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ============================================
// TRANSFERENCIAS
// ============================================

// Validar destino
router.get('/transfers/validate', userAuthMiddleware, async (req: AuthRequest, res) => {
  try {
    const { destination } = req.query;
    if (!destination) {
      return res.status(400).json({ success: false, error: 'destination requerido' });
    }

    const result = await transferService.validateDestination(destination as string);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Motivos de transferencia BCRA
router.get('/transfers/motivos', userAuthMiddleware, (req: AuthRequest, res) => {
  const motivos = Object.entries(MOTIVOS_BCRA).map(([code, description]) => ({
    code,
    description
  }));
  res.json({ success: true, data: motivos });
});

// Realizar transferencia
router.post('/transfers', userAuthMiddleware, async (req: AuthRequest, res) => {
  try {
    const { destinationCvu, amount, motive, reference, paymentMethod, installments } = req.body;

    if (!destinationCvu || !amount || !motive) {
      return res.status(400).json({ 
        success: false, 
        error: 'destinationCvu, amount y motive requeridos' 
      });
    }

    const result = await transferService.transfer({
      userId: req.user!.id,
      destinationCvu,
      amount: parseFloat(amount),
      motive,
      reference,
      paymentMethod: paymentMethod || 'account',
      installments: installments ? parseInt(installments) : undefined
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Historial de transferencias
router.get('/transfers/history', userAuthMiddleware, async (req: AuthRequest, res) => {
  try {
    const { page, limit, type } = req.query;
    const result = await transferService.getHistory(req.user!.id, {
      page: page ? parseInt(page as string) : 1,
      limit: limit ? parseInt(limit as string) : 20,
      type: type as 'in' | 'out' | 'all'
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ============================================
// CONTACTOS
// ============================================

// Listar contactos
router.get('/contacts', userAuthMiddleware, async (req: AuthRequest, res) => {
  try {
    const { orderBy, search } = req.query;
    const result = await contactsService.list(req.user!.id, {
      orderBy: orderBy as 'name' | 'frequency' | 'recent',
      search: search as string
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Crear contacto
router.post('/contacts', userAuthMiddleware, async (req: AuthRequest, res) => {
  try {
    const { cvu, alias, nickname } = req.body;
    if (!cvu && !alias) {
      return res.status(400).json({ success: false, error: 'cvu o alias requerido' });
    }

    const result = await contactsService.create({
      userId: req.user!.id,
      cvu: cvu || '',
      alias,
      nickname
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Obtener contacto
router.get('/contacts/:id', userAuthMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await contactsService.get(req.user!.id, req.params.id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(404).json({ success: false, error: error.message });
  }
});

// Actualizar contacto
router.patch('/contacts/:id', userAuthMiddleware, async (req: AuthRequest, res) => {
  try {
    const { nickname } = req.body;
    const result = await contactsService.update(req.user!.id, req.params.id, { nickname });
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Eliminar contacto
router.delete('/contacts/:id', userAuthMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await contactsService.delete(req.user!.id, req.params.id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Contactos frecuentes
router.get('/contacts/frequent', userAuthMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await contactsService.getFrequent(req.user!.id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ============================================
// CUENTA
// ============================================

// Obtener límites
router.get('/account/limits', userAuthMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await accountService.getLimits(req.user!.id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Cambiar alias
router.put('/account/alias', userAuthMiddleware, async (req: AuthRequest, res) => {
  try {
    const { alias } = req.body;
    if (!alias) {
      return res.status(400).json({ success: false, error: 'alias requerido' });
    }

    const result = await accountService.changeAlias(req.user!.id, alias);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ============================================
// FINANCIACIONES
// ============================================

// Caída de cuotas
router.post('/financings/:id/early-close', userAuthMiddleware, async (req: AuthRequest, res) => {
  try {
    const { reason } = req.body;
    const result = await accountService.earlyCloseFinancing(
      req.user!.id, 
      req.params.id, 
      reason
    );

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ============================================
// NOTIFICACIONES
// ============================================

// Registrar token FCM
router.post('/notifications/register', userAuthMiddleware, async (req: AuthRequest, res) => {
  try {
    const { token, platform } = req.body;
    if (!token || !platform) {
      return res.status(400).json({ success: false, error: 'token y platform requeridos' });
    }

    const result = await pushNotificationService.registerToken(
      req.user!.id, 
      token, 
      platform
    );

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Eliminar token
router.delete('/notifications/token', userAuthMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await pushNotificationService.removeToken(req.user!.id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Listar notificaciones
router.get('/notifications', userAuthMiddleware, async (req: AuthRequest, res) => {
  try {
    const { page, limit, unreadOnly } = req.query;
    const result = await pushNotificationService.getNotifications(req.user!.id, {
      page: page ? parseInt(page as string) : 1,
      limit: limit ? parseInt(limit as string) : 20,
      unreadOnly: unreadOnly === 'true'
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Marcar como leídas
router.post('/notifications/read', userAuthMiddleware, async (req: AuthRequest, res) => {
  try {
    const { notificationIds } = req.body;
    if (!notificationIds || !Array.isArray(notificationIds)) {
      return res.status(400).json({ success: false, error: 'notificationIds requerido' });
    }

    const result = await pushNotificationService.markAsRead(req.user!.id, notificationIds);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Marcar todas como leídas
router.post('/notifications/read-all', userAuthMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await pushNotificationService.markAllAsRead(req.user!.id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

export default router;
