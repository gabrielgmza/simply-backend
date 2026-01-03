import { Router, raw } from 'express';
import { authMiddleware, requirePermission, AuthRequest } from '../middleware/auth';
import { appAuthMiddleware, requireKYC, AppAuthRequest } from '../middleware/appAuth';
import { stripeService } from '../services/providers/stripeService';
import { bcraService } from '../services/providers/bcraService';

const router = Router();

// ============================================
// CRYPTO ONRAMP (App)
// ============================================

// Obtener cotización crypto
router.post('/crypto/quote', appAuthMiddleware, async (req: AppAuthRequest, res) => {
  try {
    const { sourceAmount, sourceCurrency, destinationCurrency, destinationNetwork } = req.body;
    
    if (!sourceAmount || !destinationCurrency || !destinationNetwork) {
      return res.status(400).json({ success: false, error: 'Parámetros incompletos' });
    }

    const quote = await stripeService.getCryptoQuote({
      sourceAmount: parseFloat(sourceAmount),
      sourceCurrency: sourceCurrency || 'usd',
      destinationCurrency,
      destinationNetwork
    });

    res.json({ success: true, data: quote });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Crear sesión de compra crypto
router.post('/crypto/session', appAuthMiddleware, requireKYC, async (req: AppAuthRequest, res) => {
  try {
    const { walletAddress, destinationCurrency, destinationNetwork, destinationAmount, sourceAmount, sourceCurrency } = req.body;

    if (!walletAddress || !destinationCurrency || !destinationNetwork) {
      return res.status(400).json({ success: false, error: 'Parámetros incompletos' });
    }

    const session = await stripeService.createCryptoOnrampSession({
      userId: req.user!.userId,
      walletAddress,
      destinationCurrency,
      destinationNetwork,
      destinationAmount,
      sourceAmount: sourceAmount ? parseFloat(sourceAmount) : undefined,
      sourceCurrency
    });

    res.json({ success: true, data: session });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Estado de sesión crypto
router.get('/crypto/session/:sessionId', appAuthMiddleware, async (req: AppAuthRequest, res) => {
  try {
    const status = await stripeService.getCryptoSessionStatus(req.params.sessionId);
    res.json({ success: true, data: status });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Assets disponibles
router.get('/crypto/assets', async (req, res) => {
  res.json({
    success: true,
    data: {
      assets: [
        { symbol: 'eth', name: 'Ethereum', networks: ['ethereum', 'base'] },
        { symbol: 'btc', name: 'Bitcoin', networks: ['bitcoin'] },
        { symbol: 'sol', name: 'Solana', networks: ['solana'] },
        { symbol: 'usdc', name: 'USD Coin', networks: ['ethereum', 'solana', 'polygon', 'base'] },
        { symbol: 'matic', name: 'Polygon', networks: ['polygon'] },
        { symbol: 'avax', name: 'Avalanche', networks: ['avalanche'] }
      ]
    }
  });
});

// ============================================
// PIX PAYMENTS (Brasil)
// ============================================

// Crear pago PIX
router.post('/pix/create', appAuthMiddleware, requireKYC, async (req: AppAuthRequest, res) => {
  try {
    const { amount, description } = req.body;

    if (!amount || amount < 50) { // Mínimo 0.50 BRL
      return res.status(400).json({ success: false, error: 'Monto mínimo: R$ 0.50' });
    }

    const payment = await stripeService.createPIXPayment({
      userId: req.user!.userId,
      amount: Math.round(amount * 100), // Convertir a centavos
      description,
      expiresInSeconds: 3600 // 1 hora
    });

    res.json({ success: true, data: payment });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Estado de pago PIX
router.get('/pix/:paymentIntentId', appAuthMiddleware, async (req: AppAuthRequest, res) => {
  try {
    const status = await stripeService.getPIXPaymentStatus(req.params.paymentIntentId);
    res.json({ success: true, data: status });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ============================================
// CARD PAYMENTS (Internacional)
// ============================================

// Crear intent de pago con tarjeta
router.post('/card/create-intent', appAuthMiddleware, requireKYC, async (req: AppAuthRequest, res) => {
  try {
    const { amount, currency, description } = req.body;

    if (!amount || !currency) {
      return res.status(400).json({ success: false, error: 'amount y currency requeridos' });
    }

    const result = await stripeService.createCardPayment({
      userId: req.user!.userId,
      amount: Math.round(amount * 100),
      currency,
      description
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ============================================
// STRIPE WEBHOOKS
// ============================================

router.post('/stripe/webhook', raw({ type: 'application/json' }), async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'] as string;
    const event = stripeService.verifyWebhookSignature(req.body, sig);
    
    await stripeService.handleWebhook(event);
    res.json({ received: true });
  } catch (error: any) {
    console.error('Webhook error:', error.message);
    res.status(400).json({ error: error.message });
  }
});

// ============================================
// BCRA - COTIZACIÓN USD (App & Backoffice)
// ============================================

// Cotización actual
router.get('/bcra/usd', async (req, res) => {
  try {
    const cotizacion = await bcraService.getCotizacionUSD();
    res.json({ success: true, data: cotizacion });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Histórico de cotizaciones
router.get('/bcra/usd/historico', async (req, res) => {
  try {
    const dias = parseInt(req.query.dias as string) || 30;
    const historico = await bcraService.getCotizacionHistorico(dias);
    res.json({ success: true, data: historico });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// BCRA - CENTRAL DE DEUDORES (Backoffice)
// ============================================

// Consultar deudor por CUIT
router.get('/bcra/deudor/:cuit', authMiddleware, requirePermission('compliance:read'), async (req: AuthRequest, res) => {
  try {
    const resultado = await bcraService.consultarDeudor(req.params.cuit);
    
    if (!resultado) {
      return res.json({ 
        success: true, 
        data: { 
          cuit: req.params.cuit, 
          sinDeudas: true, 
          mensaje: 'Sin deudas registradas en el sistema financiero' 
        } 
      });
    }

    res.json({ success: true, data: resultado });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Evaluar riesgo crediticio
router.get('/bcra/riesgo/:cuit', authMiddleware, requirePermission('compliance:read'), async (req: AuthRequest, res) => {
  try {
    const evaluacion = await bcraService.evaluarRiesgoCrediticio(req.params.cuit);
    res.json({ success: true, data: evaluacion });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Consultar usuario por ID (con CUIT del perfil)
router.get('/bcra/usuario/:userId', authMiddleware, requirePermission('users:read'), async (req: AuthRequest, res) => {
  try {
    const resultado = await bcraService.consultarLegajoUsuario(req.params.userId);
    
    if (!resultado) {
      return res.status(400).json({ success: false, error: 'Usuario sin DNI/CUIL registrado' });
    }

    res.json({ success: true, data: resultado });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Historial de consultas de un CUIT
router.get('/bcra/historial/:cuit', authMiddleware, requirePermission('compliance:read'), async (req: AuthRequest, res) => {
  try {
    const historial = await bcraService.getHistorialConsultas(req.params.cuit);
    res.json({ success: true, data: historial });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

export default router;
