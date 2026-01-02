import { PrismaClient } from '@prisma/client';
import { auditLogService } from './auditLogService';
import crypto from 'crypto';

const prisma = new PrismaClient();

// ============================================
// CONFIGURACIÓN DE PROVEEDORES
// ============================================

export const PROVIDER_DEFINITIONS = {
  // Banco BIND - Operaciones bancarias
  bind: {
    name: 'Banco BIND',
    description: 'Procesamiento de operaciones bancarias, CVU, transferencias',
    category: 'banking',
    baseUrl: process.env.BIND_API_URL || 'https://api.bind.com.ar',
    requiredCredentials: ['client_id', 'client_secret', 'account_id'],
    webhookSupport: true,
    healthEndpoint: '/health',
    features: ['cvu_generation', 'transfers', 'balance', 'statements']
  },
  
  // didit.me - KYC/Verificación de identidad
  didit: {
    name: 'didit.me',
    description: 'Verificación de identidad KYC, biometría, screening',
    category: 'kyc',
    baseUrl: process.env.DIDIT_API_URL || 'https://api.didit.me',
    requiredCredentials: ['api_key', 'webhook_secret'],
    webhookSupport: true,
    healthEndpoint: '/v1/health',
    features: ['identity_verification', 'biometric', 'aml_screening', 'document_verification']
  },
  
  // Stripe - Crypto onramp
  stripe: {
    name: 'Stripe',
    description: 'Onramp de criptomonedas, pagos internacionales',
    category: 'payments',
    baseUrl: 'https://api.stripe.com',
    requiredCredentials: ['secret_key', 'publishable_key', 'webhook_secret'],
    webhookSupport: true,
    healthEndpoint: null,
    features: ['crypto_onramp', 'payments', 'pix_brazil']
  },
  
  // BCRA - Central de deudores
  bcra: {
    name: 'BCRA',
    description: 'Central de deudores, información crediticia',
    category: 'credit',
    baseUrl: process.env.BCRA_API_URL || 'https://api.bcra.gob.ar',
    requiredCredentials: ['api_key', 'entity_id'],
    webhookSupport: false,
    healthEndpoint: '/health',
    features: ['credit_report', 'debtor_status']
  },
  
  // COELSA - Interoperabilidad
  coelsa: {
    name: 'COELSA',
    description: 'Interoperabilidad CVU, transferencias, QR',
    category: 'interoperability',
    baseUrl: process.env.COELSA_API_URL || 'https://api.coelsa.com.ar',
    requiredCredentials: ['participant_id', 'certificate', 'private_key'],
    webhookSupport: true,
    healthEndpoint: '/v1/health',
    features: ['cvu_interop', 'debin', 'qr_payments', 'transfers']
  },
  
  // Rapipago - Recaudación
  rapipago: {
    name: 'Rapipago',
    description: 'Red de cobranza, pago de servicios, recargas',
    category: 'collection',
    baseUrl: process.env.RAPIPAGO_API_URL || 'https://api.rapipago.com.ar',
    requiredCredentials: ['merchant_id', 'api_key', 'secret'],
    webhookSupport: true,
    healthEndpoint: '/status',
    features: ['cash_collection', 'bill_payment', 'mobile_topup']
  },
  
  // Anthropic - AI
  anthropic: {
    name: 'Anthropic',
    description: 'API de Claude para Aria y monitoreo',
    category: 'ai',
    baseUrl: 'https://api.anthropic.com',
    requiredCredentials: ['api_key'],
    webhookSupport: false,
    healthEndpoint: null,
    features: ['chat_completion', 'embeddings']
  },
  
  // reCAPTCHA
  recaptcha: {
    name: 'Google reCAPTCHA',
    description: 'Protección anti-bot',
    category: 'security',
    baseUrl: 'https://www.google.com/recaptcha/api',
    requiredCredentials: ['site_key', 'secret_key'],
    webhookSupport: false,
    healthEndpoint: null,
    features: ['captcha_verification']
  }
};

type ProviderSlug = keyof typeof PROVIDER_DEFINITIONS;

// ============================================
// TIPOS
// ============================================

interface ProviderConfig {
  slug: string;
  credentials: Record<string, string>;
  settings?: Record<string, any>;
  webhookUrl?: string;
}

interface ProviderStatus {
  slug: string;
  name: string;
  status: 'active' | 'inactive' | 'error' | 'not_configured';
  lastCheck?: Date;
  lastError?: string;
  latencyMs?: number;
}

interface WebhookEvent {
  providerId: string;
  eventType: string;
  payload: any;
  signature?: string;
  receivedAt: Date;
}

// ============================================
// PROVIDER SERVICE
// ============================================

export const providerService = {
  // -------------------------------------------
  // GESTIÓN DE PROVEEDORES
  // -------------------------------------------
  
  async getProviders() {
    const configured = await prisma.providers.findMany({
      orderBy: { name: 'asc' }
    });
    
    // Combinar con definiciones
    const all = Object.entries(PROVIDER_DEFINITIONS).map(([slug, def]) => {
      const config = configured.find(c => c.slug === slug);
      return {
        slug,
        ...def,
        configured: !!config,
        status: config?.status || 'not_configured',
        lastHealthCheck: config?.last_health_check,
        createdAt: config?.created_at
      };
    });
    
    return all;
  },
  
  async getProvider(slug: string) {
    const definition = PROVIDER_DEFINITIONS[slug as ProviderSlug];
    if (!definition) return null;
    
    const config = await prisma.providers.findUnique({
      where: { slug }
    });
    
    return {
      slug,
      ...definition,
      config: config ? {
        status: config.status,
        settings: config.settings,
        webhookUrl: config.webhook_url,
        lastHealthCheck: config.last_health_check,
        lastError: config.last_error
      } : null
    };
  },
  
  async configureProvider(slug: string, data: {
    credentials: Record<string, string>;
    settings?: Record<string, any>;
    webhookUrl?: string;
  }, employeeId: string) {
    const definition = PROVIDER_DEFINITIONS[slug as ProviderSlug];
    if (!definition) throw new Error('Proveedor no reconocido');
    
    // Validar credenciales requeridas
    for (const key of definition.requiredCredentials) {
      if (!data.credentials[key]) {
        throw new Error(`Credencial requerida: ${key}`);
      }
    }
    
    // Encriptar credenciales
    const encryptedCredentials = this.encryptCredentials(data.credentials);
    
    const provider = await prisma.providers.upsert({
      where: { slug },
      update: {
        credentials: encryptedCredentials,
        settings: data.settings || {},
        webhook_url: data.webhookUrl,
        status: 'inactive', // Se activa después de health check
        updated_at: new Date()
      },
      create: {
        slug,
        name: definition.name,
        category: definition.category,
        base_url: definition.baseUrl,
        credentials: encryptedCredentials,
        settings: data.settings || {},
        webhook_url: data.webhookUrl,
        status: 'inactive'
      }
    });
    
    // Audit log (sin credenciales)
    await auditLogService.log({
      actorType: 'employee',
      actorId: employeeId,
      action: 'provider_configured',
      resource: 'providers',
      resourceId: slug,
      description: `Proveedor ${definition.name} configurado`,
      metadata: { settings: data.settings, hasWebhook: !!data.webhookUrl }
    });
    
    // Test de conexión
    const healthResult = await this.checkHealth(slug);
    
    return { provider, healthResult };
  },
  
  async activateProvider(slug: string, employeeId: string) {
    const provider = await prisma.providers.findUnique({ where: { slug } });
    if (!provider) throw new Error('Proveedor no configurado');
    
    // Verificar health antes de activar
    const health = await this.checkHealth(slug);
    if (!health.healthy) {
      throw new Error(`No se puede activar: ${health.error}`);
    }
    
    await prisma.providers.update({
      where: { slug },
      data: { status: 'active' }
    });
    
    await auditLogService.log({
      actorType: 'employee',
      actorId: employeeId,
      action: 'provider_activated',
      resource: 'providers',
      resourceId: slug,
      description: `Proveedor ${slug} activado`
    });
    
    return { success: true };
  },
  
  async deactivateProvider(slug: string, employeeId: string, reason?: string) {
    await prisma.providers.update({
      where: { slug },
      data: { status: 'inactive' }
    });
    
    await auditLogService.log({
      actorType: 'employee',
      actorId: employeeId,
      action: 'provider_deactivated',
      resource: 'providers',
      resourceId: slug,
      description: `Proveedor ${slug} desactivado`,
      metadata: { reason }
    });
    
    return { success: true };
  },
  
  // -------------------------------------------
  // HEALTH CHECKS
  // -------------------------------------------
  
  async checkHealth(slug: string): Promise<{
    healthy: boolean;
    latencyMs?: number;
    error?: string;
  }> {
    const provider = await prisma.providers.findUnique({ where: { slug } });
    if (!provider) return { healthy: false, error: 'No configurado' };
    
    const definition = PROVIDER_DEFINITIONS[slug as ProviderSlug];
    if (!definition?.healthEndpoint) {
      // Sin endpoint de health, asumir OK si tiene credenciales
      return { healthy: true };
    }
    
    const startTime = Date.now();
    
    try {
      const credentials = this.decryptCredentials(provider.credentials as Record<string, string>);
      
      const response = await fetch(`${provider.base_url}${definition.healthEndpoint}`, {
        method: 'GET',
        headers: this.getAuthHeaders(slug, credentials),
        signal: AbortSignal.timeout(10000) // 10s timeout
      });
      
      const latencyMs = Date.now() - startTime;
      const healthy = response.ok;
      
      await prisma.providers.update({
        where: { slug },
        data: {
          last_health_check: new Date(),
          last_error: healthy ? null : `HTTP ${response.status}`,
          status: healthy && provider.status === 'active' ? 'active' : provider.status
        }
      });
      
      // Log health check
      await prisma.provider_health_logs.create({
        data: {
          provider_id: provider.id,
          status: healthy ? 'healthy' : 'unhealthy',
          latency_ms: latencyMs,
          error: healthy ? null : `HTTP ${response.status}`
        }
      });
      
      return { healthy, latencyMs };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      
      await prisma.providers.update({
        where: { slug },
        data: {
          last_health_check: new Date(),
          last_error: error.message,
          status: 'error'
        }
      });
      
      await prisma.provider_health_logs.create({
        data: {
          provider_id: provider.id,
          status: 'error',
          latency_ms: latencyMs,
          error: error.message
        }
      });
      
      return { healthy: false, latencyMs, error: error.message };
    }
  },
  
  async checkAllProviders(): Promise<ProviderStatus[]> {
    const providers = await prisma.providers.findMany({
      where: { status: { in: ['active', 'error'] } }
    });
    
    const results: ProviderStatus[] = [];
    
    for (const provider of providers) {
      const health = await this.checkHealth(provider.slug);
      results.push({
        slug: provider.slug,
        name: provider.name,
        status: health.healthy ? 'active' : 'error',
        lastCheck: new Date(),
        lastError: health.error,
        latencyMs: health.latencyMs
      });
    }
    
    return results;
  },
  
  getAuthHeaders(slug: string, credentials: Record<string, string>): Record<string, string> {
    switch (slug) {
      case 'bind':
        return {
          'Authorization': `Bearer ${credentials.access_token || ''}`,
          'Content-Type': 'application/json'
        };
      case 'didit':
        return {
          'X-API-Key': credentials.api_key,
          'Content-Type': 'application/json'
        };
      case 'stripe':
        return {
          'Authorization': `Bearer ${credentials.secret_key}`,
          'Content-Type': 'application/json'
        };
      case 'bcra':
        return {
          'X-API-Key': credentials.api_key,
          'Content-Type': 'application/json'
        };
      case 'anthropic':
        return {
          'x-api-key': credentials.api_key,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        };
      default:
        return { 'Content-Type': 'application/json' };
    }
  },
  
  // -------------------------------------------
  // WEBHOOKS
  // -------------------------------------------
  
  async processWebhook(slug: string, payload: any, signature?: string, headers?: Record<string, string>) {
    const provider = await prisma.providers.findUnique({ where: { slug } });
    if (!provider) throw new Error('Proveedor no encontrado');
    
    const credentials = this.decryptCredentials(provider.credentials as Record<string, string>);
    
    // Verificar firma si aplica
    if (PROVIDER_DEFINITIONS[slug as ProviderSlug]?.webhookSupport) {
      const isValid = await this.verifyWebhookSignature(slug, payload, signature, credentials);
      if (!isValid) {
        throw new Error('Firma de webhook inválida');
      }
    }
    
    // Guardar evento
    const event = await prisma.provider_webhook_events.create({
      data: {
        provider_id: provider.id,
        event_type: payload.type || payload.event || 'unknown',
        payload,
        signature,
        status: 'received'
      }
    });
    
    // Procesar según proveedor
    try {
      const result = await this.handleWebhookEvent(slug, payload);
      
      await prisma.provider_webhook_events.update({
        where: { id: event.id },
        data: {
          status: 'processed',
          processed_at: new Date(),
          result
        }
      });
      
      return { success: true, eventId: event.id };
    } catch (error: any) {
      await prisma.provider_webhook_events.update({
        where: { id: event.id },
        data: {
          status: 'failed',
          error: error.message
        }
      });
      
      throw error;
    }
  },
  
  async verifyWebhookSignature(slug: string, payload: any, signature?: string, credentials?: Record<string, string>): Promise<boolean> {
    if (!signature) return false;
    
    switch (slug) {
      case 'stripe':
        // Stripe usa HMAC SHA256
        const stripePayload = JSON.stringify(payload);
        const stripeExpected = crypto
          .createHmac('sha256', credentials?.webhook_secret || '')
          .update(stripePayload)
          .digest('hex');
        return signature.includes(stripeExpected);
        
      case 'didit':
        const diditPayload = JSON.stringify(payload);
        const diditExpected = crypto
          .createHmac('sha256', credentials?.webhook_secret || '')
          .update(diditPayload)
          .digest('hex');
        return signature === diditExpected;
        
      default:
        return true; // Sin verificación para otros
    }
  },
  
  async handleWebhookEvent(slug: string, payload: any): Promise<any> {
    switch (slug) {
      case 'didit':
        return this.handleDiditWebhook(payload);
      case 'stripe':
        return this.handleStripeWebhook(payload);
      case 'bind':
        return this.handleBindWebhook(payload);
      case 'coelsa':
        return this.handleCoelsaWebhook(payload);
      default:
        return { processed: true };
    }
  },
  
  async handleDiditWebhook(payload: any) {
    const { type, data } = payload;
    
    switch (type) {
      case 'verification.completed':
        // Actualizar KYC del usuario
        if (data.user_id && data.status) {
          await prisma.users.update({
            where: { id: data.user_id },
            data: {
              kyc_status: data.status === 'approved' ? 'APPROVED' : 'REJECTED',
              status: data.status === 'approved' ? 'ACTIVE' : 'PENDING_VERIFICATION'
            }
          });
        }
        break;
    }
    
    return { type, processed: true };
  },
  
  async handleStripeWebhook(payload: any) {
    const { type, data } = payload;
    
    switch (type) {
      case 'crypto.onramp.session.completed':
        // Acreditar cripto al usuario
        console.log('Crypto onramp completado:', data);
        break;
        
      case 'payment_intent.succeeded':
        // Procesar pago exitoso
        console.log('Pago procesado:', data);
        break;
    }
    
    return { type, processed: true };
  },
  
  async handleBindWebhook(payload: any) {
    const { type, data } = payload;
    
    switch (type) {
      case 'transfer.received':
        // Notificar transferencia recibida
        console.log('Transferencia recibida:', data);
        break;
        
      case 'transfer.sent':
        // Confirmar transferencia enviada
        console.log('Transferencia enviada:', data);
        break;
    }
    
    return { type, processed: true };
  },
  
  async handleCoelsaWebhook(payload: any) {
    const { type, data } = payload;
    
    switch (type) {
      case 'debin.approved':
        console.log('DEBIN aprobado:', data);
        break;
        
      case 'qr.payment':
        console.log('Pago QR recibido:', data);
        break;
    }
    
    return { type, processed: true };
  },
  
  // -------------------------------------------
  // CREDENTIALS ENCRYPTION
  // -------------------------------------------
  
  encryptCredentials(credentials: Record<string, string>): Record<string, string> {
    const key = process.env.CREDENTIALS_ENCRYPTION_KEY || 'simply-default-key-change-me!';
    const encrypted: Record<string, string> = {};
    
    for (const [k, v] of Object.entries(credentials)) {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key.padEnd(32).slice(0, 32)), iv);
      let enc = cipher.update(v, 'utf8', 'hex');
      enc += cipher.final('hex');
      encrypted[k] = `${iv.toString('hex')}:${enc}`;
    }
    
    return encrypted;
  },
  
  decryptCredentials(encrypted: Record<string, string>): Record<string, string> {
    const key = process.env.CREDENTIALS_ENCRYPTION_KEY || 'simply-default-key-change-me!';
    const decrypted: Record<string, string> = {};
    
    for (const [k, v] of Object.entries(encrypted)) {
      try {
        const [ivHex, enc] = v.split(':');
        if (!ivHex || !enc) {
          decrypted[k] = v; // Ya está sin encriptar
          continue;
        }
        const iv = Buffer.from(ivHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key.padEnd(32).slice(0, 32)), iv);
        let dec = decipher.update(enc, 'hex', 'utf8');
        dec += decipher.final('utf8');
        decrypted[k] = dec;
      } catch {
        decrypted[k] = v;
      }
    }
    
    return decrypted;
  },
  
  // -------------------------------------------
  // LLAMADAS A APIs DE PROVEEDORES
  // -------------------------------------------
  
  async call(slug: string, endpoint: string, options?: {
    method?: string;
    body?: any;
    params?: Record<string, string>;
  }): Promise<any> {
    const provider = await prisma.providers.findUnique({ where: { slug } });
    if (!provider) throw new Error('Proveedor no configurado');
    if (provider.status !== 'active') throw new Error('Proveedor no activo');
    
    const credentials = this.decryptCredentials(provider.credentials as Record<string, string>);
    const headers = this.getAuthHeaders(slug, credentials);
    
    let url = `${provider.base_url}${endpoint}`;
    if (options?.params) {
      const searchParams = new URLSearchParams(options.params);
      url += `?${searchParams.toString()}`;
    }
    
    const startTime = Date.now();
    
    try {
      const response = await fetch(url, {
        method: options?.method || 'GET',
        headers,
        body: options?.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(30000)
      });
      
      const latency = Date.now() - startTime;
      
      // Log de la llamada
      await prisma.provider_api_logs.create({
        data: {
          provider_id: provider.id,
          endpoint,
          method: options?.method || 'GET',
          status_code: response.status,
          latency_ms: latency,
          success: response.ok
        }
      });
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API Error ${response.status}: ${error}`);
      }
      
      return await response.json();
    } catch (error: any) {
      const latency = Date.now() - startTime;
      
      await prisma.provider_api_logs.create({
        data: {
          provider_id: provider.id,
          endpoint,
          method: options?.method || 'GET',
          status_code: 0,
          latency_ms: latency,
          success: false,
          error: error.message
        }
      });
      
      throw error;
    }
  },
  
  // -------------------------------------------
  // ESTADÍSTICAS
  // -------------------------------------------
  
  async getProviderStats(slug: string, days = 7) {
    const provider = await prisma.providers.findUnique({ where: { slug } });
    if (!provider) return null;
    
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    const [apiCalls, webhooks, healthLogs] = await Promise.all([
      prisma.provider_api_logs.groupBy({
        by: ['success'],
        where: { provider_id: provider.id, created_at: { gte: since } },
        _count: true,
        _avg: { latency_ms: true }
      }),
      prisma.provider_webhook_events.groupBy({
        by: ['status'],
        where: { provider_id: provider.id, created_at: { gte: since } },
        _count: true
      }),
      prisma.provider_health_logs.findMany({
        where: { provider_id: provider.id, created_at: { gte: since } },
        orderBy: { created_at: 'desc' },
        take: 100
      })
    ]);
    
    const successCalls = apiCalls.find(c => c.success)?._count || 0;
    const failedCalls = apiCalls.find(c => !c.success)?._count || 0;
    const avgLatency = apiCalls.find(c => c.success)?._avg?.latency_ms || 0;
    
    const uptime = healthLogs.filter(h => h.status === 'healthy').length / Math.max(healthLogs.length, 1) * 100;
    
    return {
      apiCalls: {
        success: successCalls,
        failed: failedCalls,
        total: successCalls + failedCalls,
        successRate: successCalls / Math.max(successCalls + failedCalls, 1) * 100,
        avgLatencyMs: Math.round(avgLatency)
      },
      webhooks: Object.fromEntries(webhooks.map(w => [w.status, w._count])),
      uptime: Math.round(uptime * 100) / 100,
      lastHealthCheck: provider.last_health_check
    };
  }
};
