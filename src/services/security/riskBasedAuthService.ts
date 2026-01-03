import { PrismaClient } from '@prisma/client';
import { trustScoreService } from './trustScoreService';
import { deviceFingerprintService } from './deviceFingerprintService';
import crypto from 'crypto';

const prisma = new PrismaClient();

// ============================================
// RISK-BASED AUTHENTICATION
// Fricción adaptativa: mínima para buenos, máxima para sospechosos
// ============================================

export type RiskLevel = 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type AuthAction = 
  | 'ALLOW'           // Sin fricción adicional
  | 'BIOMETRY'        // Solo biometría
  | 'PIN'             // Requerir PIN
  | 'OTP'             // Enviar código OTP
  | '2FA'             // 2FA completo (TOTP)
  | 'STEP_UP'         // Biometría + 2FA
  | 'COOLDOWN'        // Esperar X minutos
  | 'BLOCK'           // Bloquear operación
  | 'MANUAL_REVIEW';  // Requiere revisión humana

export interface RiskAssessment {
  userId: string;
  sessionId: string;
  operation: string;
  
  // Scores
  riskScore: number;           // 0-100
  riskLevel: RiskLevel;
  
  // Factores de riesgo detectados
  riskFactors: RiskFactor[];
  
  // Acción requerida
  requiredAction: AuthAction;
  
  // Metadata
  deviceTrusted: boolean;
  locationTrusted: boolean;
  timeTrusted: boolean;
  
  // Cooldown si aplica
  cooldownMinutes?: number;
  
  // Mensaje para el usuario
  userMessage: string;
}

interface RiskFactor {
  factor: string;
  weight: number;          // Peso en el score (0-100)
  description: string;
  mitigatable: boolean;    // Si el usuario puede mitigar con step-up
}

interface OperationContext {
  userId: string;
  operation: string;       // 'transfer', 'login', 'withdraw', 'change_password', etc.
  amount?: number;
  destinationCvu?: string;
  deviceFingerprint?: string;
  ipAddress: string;
  userAgent: string;
  geoLocation?: { lat: number; lng: number; country: string; city: string };
  sessionId: string;
}

// Pesos de operaciones (criticidad base)
const OPERATION_BASE_RISK: Record<string, number> = {
  'login': 10,
  'view_balance': 0,
  'view_transactions': 0,
  'transfer_internal': 20,
  'transfer_external': 35,
  'transfer_new_recipient': 50,
  'withdraw': 40,
  'invest': 15,
  'financing_request': 30,
  'change_password': 60,
  'change_email': 70,
  'change_phone': 70,
  'add_card': 40,
  'export_data': 50,
  'close_account': 90
};

// Umbrales de riesgo → acción
const RISK_THRESHOLDS = {
  MINIMAL: { max: 15, action: 'ALLOW' as AuthAction },
  LOW: { max: 30, action: 'BIOMETRY' as AuthAction },
  MEDIUM: { max: 50, action: 'OTP' as AuthAction },
  HIGH: { max: 75, action: 'STEP_UP' as AuthAction },
  CRITICAL: { max: 100, action: 'BLOCK' as AuthAction }
};

export const riskBasedAuthService = {
  // ==========================================
  // EVALUAR RIESGO DE OPERACIÓN
  // ==========================================

  async assessRisk(context: OperationContext): Promise<RiskAssessment> {
    const riskFactors: RiskFactor[] = [];
    let riskScore = 0;

    // 1. Riesgo base de la operación
    const baseRisk = OPERATION_BASE_RISK[context.operation] || 25;
    riskScore += baseRisk;
    if (baseRisk > 0) {
      riskFactors.push({
        factor: 'OPERATION_TYPE',
        weight: baseRisk,
        description: `Operación: ${context.operation}`,
        mitigatable: false
      });
    }

    // 2. Evaluar dispositivo
    const deviceRisk = await this.evaluateDevice(context, riskFactors);
    riskScore += deviceRisk;

    // 3. Evaluar ubicación
    const locationRisk = await this.evaluateLocation(context, riskFactors);
    riskScore += locationRisk;

    // 4. Evaluar tiempo/horario
    const timeRisk = this.evaluateTime(context, riskFactors);
    riskScore += timeRisk;

    // 5. Evaluar monto (si aplica)
    if (context.amount) {
      const amountRisk = await this.evaluateAmount(context, riskFactors);
      riskScore += amountRisk;
    }

    // 6. Evaluar destinatario (si aplica)
    if (context.destinationCvu) {
      const recipientRisk = await this.evaluateRecipient(context, riskFactors);
      riskScore += recipientRisk;
    }

    // 7. Evaluar historial reciente
    const historyRisk = await this.evaluateRecentHistory(context, riskFactors);
    riskScore += historyRisk;

    // 8. Ajustar por Trust Score
    const trustAdjustment = await this.applyTrustScoreAdjustment(context.userId, riskScore);
    riskScore = trustAdjustment.adjustedScore;
    if (trustAdjustment.factor) {
      riskFactors.push(trustAdjustment.factor);
    }

    // Normalizar a 0-100
    riskScore = Math.min(100, Math.max(0, riskScore));

    // Determinar nivel y acción
    const { riskLevel, requiredAction } = this.determineActionFromScore(riskScore, context);

    // Calcular cooldown si es necesario
    const cooldownMinutes = requiredAction === 'COOLDOWN' ? this.calculateCooldown(riskScore) : undefined;

    // Generar mensaje amigable
    const userMessage = this.generateUserMessage(requiredAction, riskFactors);

    // Registrar evaluación
    await this.logRiskAssessment(context, riskScore, riskLevel, requiredAction, riskFactors);

    return {
      userId: context.userId,
      sessionId: context.sessionId,
      operation: context.operation,
      riskScore,
      riskLevel,
      riskFactors,
      requiredAction,
      deviceTrusted: riskFactors.every(f => f.factor !== 'UNKNOWN_DEVICE' && f.factor !== 'NEW_DEVICE'),
      locationTrusted: riskFactors.every(f => !f.factor.includes('LOCATION')),
      timeTrusted: riskFactors.every(f => !f.factor.includes('TIME')),
      cooldownMinutes,
      userMessage
    };
  },

  // ==========================================
  // EVALUADORES DE RIESGO
  // ==========================================

  async evaluateDevice(context: OperationContext, factors: RiskFactor[]): Promise<number> {
    if (!context.deviceFingerprint) {
      factors.push({
        factor: 'NO_DEVICE_INFO',
        weight: 15,
        description: 'Sin información del dispositivo',
        mitigatable: true
      });
      return 15;
    }

    const device = await deviceFingerprintService.getDevice(context.userId, context.deviceFingerprint);

    if (!device) {
      factors.push({
        factor: 'NEW_DEVICE',
        weight: 25,
        description: 'Dispositivo nuevo no registrado',
        mitigatable: true
      });
      return 25;
    }

    if (device.trustLevel === 'UNTRUSTED') {
      factors.push({
        factor: 'UNTRUSTED_DEVICE',
        weight: 35,
        description: 'Dispositivo marcado como no confiable',
        mitigatable: true
      });
      return 35;
    }

    if (device.trustLevel === 'TRUSTED') {
      factors.push({
        factor: 'TRUSTED_DEVICE',
        weight: -10,
        description: 'Dispositivo de confianza',
        mitigatable: false
      });
      return -10; // Bonus por dispositivo confiable
    }

    return 0;
  },

  async evaluateLocation(context: OperationContext, factors: RiskFactor[]): Promise<number> {
    let risk = 0;

    // IP en blacklist
    const ipBlacklisted = await this.isIPBlacklisted(context.ipAddress);
    if (ipBlacklisted) {
      factors.push({
        factor: 'BLACKLISTED_IP',
        weight: 50,
        description: 'IP en lista negra',
        mitigatable: false
      });
      return 50;
    }

    // VPN/Proxy detection
    const isProxy = await this.detectVPNProxy(context.ipAddress);
    if (isProxy) {
      factors.push({
        factor: 'VPN_PROXY_DETECTED',
        weight: 20,
        description: 'Conexión vía VPN o proxy detectada',
        mitigatable: true
      });
      risk += 20;
    }

    // Geolocation check
    if (context.geoLocation) {
      // País de alto riesgo (GAFI)
      const highRiskCountries = ['KP', 'IR', 'SY', 'MM', 'AF', 'YE'];
      if (highRiskCountries.includes(context.geoLocation.country)) {
        factors.push({
          factor: 'HIGH_RISK_COUNTRY',
          weight: 40,
          description: `País de alto riesgo: ${context.geoLocation.country}`,
          mitigatable: false
        });
        risk += 40;
      }

      // Viaje imposible
      const impossibleTravel = await this.checkImpossibleTravel(context.userId, context.geoLocation);
      if (impossibleTravel) {
        factors.push({
          factor: 'IMPOSSIBLE_TRAVEL',
          weight: 35,
          description: 'Ubicación inconsistente con historial reciente',
          mitigatable: true
        });
        risk += 35;
      }
    }

    return risk;
  },

  evaluateTime(context: OperationContext, factors: RiskFactor[]): number {
    const now = new Date();
    const hour = now.getHours();

    // Horario inusual (2am - 5am)
    if (hour >= 2 && hour <= 5) {
      factors.push({
        factor: 'UNUSUAL_TIME',
        weight: 10,
        description: 'Operación en horario inusual',
        mitigatable: true
      });
      return 10;
    }

    return 0;
  },

  async evaluateAmount(context: OperationContext, factors: RiskFactor[]): Promise<number> {
    const amount = context.amount || 0;

    // Obtener promedio histórico
    const avgAmount = await this.getUserAverageAmount(context.userId, context.operation);

    // Monto muy superior al promedio
    if (avgAmount > 0 && amount > avgAmount * 5) {
      factors.push({
        factor: 'AMOUNT_5X_AVERAGE',
        weight: 30,
        description: `Monto 5x superior al promedio ($${avgAmount.toFixed(0)})`,
        mitigatable: true
      });
      return 30;
    }

    if (avgAmount > 0 && amount > avgAmount * 3) {
      factors.push({
        factor: 'AMOUNT_3X_AVERAGE',
        weight: 15,
        description: `Monto 3x superior al promedio`,
        mitigatable: true
      });
      return 15;
    }

    // Montos altos absolutos
    if (amount >= 1000000) { // $1M+
      factors.push({
        factor: 'HIGH_AMOUNT',
        weight: 20,
        description: 'Monto alto (>$1M)',
        mitigatable: true
      });
      return 20;
    }

    return 0;
  },

  async evaluateRecipient(context: OperationContext, factors: RiskFactor[]): Promise<number> {
    const cvu = context.destinationCvu!;

    // Verificar si es contacto frecuente
    const contact = await prisma.contacts.findFirst({
      where: {
        user_id: context.userId,
        cvu
      }
    });

    if (contact && contact.transfer_count >= 3) {
      factors.push({
        factor: 'FREQUENT_RECIPIENT',
        weight: -10,
        description: 'Destinatario frecuente',
        mitigatable: false
      });
      return -10; // Bonus
    }

    // Primera transferencia a este destinatario
    const previousTransfer = await prisma.transactions.findFirst({
      where: {
        user_id: context.userId,
        destination_cvu: cvu,
        status: 'COMPLETED'
      }
    });

    if (!previousTransfer) {
      factors.push({
        factor: 'NEW_RECIPIENT',
        weight: 20,
        description: 'Primera transferencia a este destinatario',
        mitigatable: true
      });
      return 20;
    }

    return 0;
  },

  async evaluateRecentHistory(context: OperationContext, factors: RiskFactor[]): Promise<number> {
    let risk = 0;
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Múltiples operaciones en la última hora
    const recentOps = await prisma.transactions.count({
      where: {
        user_id: context.userId,
        created_at: { gte: oneHourAgo }
      }
    });

    if (recentOps >= 10) {
      factors.push({
        factor: 'HIGH_VELOCITY',
        weight: 25,
        description: '10+ operaciones en la última hora',
        mitigatable: true
      });
      risk += 25;
    } else if (recentOps >= 5) {
      factors.push({
        factor: 'ELEVATED_VELOCITY',
        weight: 10,
        description: '5+ operaciones en la última hora',
        mitigatable: true
      });
      risk += 10;
    }

    // Intentos de login fallidos
    const failedLogins = await prisma.audit_logs.count({
      where: {
        actor_id: context.userId,
        action: 'LOGIN_FAILED',
        created_at: { gte: oneDayAgo }
      }
    });

    if (failedLogins >= 3) {
      factors.push({
        factor: 'FAILED_LOGINS',
        weight: 15,
        description: `${failedLogins} intentos de login fallidos (24h)`,
        mitigatable: true
      });
      risk += 15;
    }

    // Alertas de fraude recientes
    const fraudAlerts = await prisma.fraud_alerts.count({
      where: {
        user_id: context.userId,
        created_at: { gte: oneDayAgo },
        status: { in: ['PENDING', 'INVESTIGATING'] }
      }
    });

    if (fraudAlerts > 0) {
      factors.push({
        factor: 'RECENT_FRAUD_ALERT',
        weight: 30,
        description: 'Alerta de fraude activa',
        mitigatable: false
      });
      risk += 30;
    }

    return risk;
  },

  async applyTrustScoreAdjustment(userId: string, currentRisk: number): Promise<{ adjustedScore: number; factor?: RiskFactor }> {
    try {
      const trustScore = await trustScoreService.getScore(userId);

      // Elite users (800+): Reducir riesgo
      if (trustScore.globalScore >= 800) {
        return {
          adjustedScore: Math.max(0, currentRisk - 20),
          factor: {
            factor: 'ELITE_TRUST_SCORE',
            weight: -20,
            description: 'Trust Score Elite (800+)',
            mitigatable: false
          }
        };
      }

      // High users (600-799): Reducir un poco
      if (trustScore.globalScore >= 600) {
        return {
          adjustedScore: Math.max(0, currentRisk - 10),
          factor: {
            factor: 'HIGH_TRUST_SCORE',
            weight: -10,
            description: 'Trust Score Alto (600+)',
            mitigatable: false
          }
        };
      }

      // Low users (200-399): Aumentar riesgo
      if (trustScore.globalScore < 400) {
        return {
          adjustedScore: currentRisk + 15,
          factor: {
            factor: 'LOW_TRUST_SCORE',
            weight: 15,
            description: 'Trust Score Bajo (<400)',
            mitigatable: false
          }
        };
      }

      // Critical users (<200): Aumentar mucho
      if (trustScore.globalScore < 200) {
        return {
          adjustedScore: currentRisk + 30,
          factor: {
            factor: 'CRITICAL_TRUST_SCORE',
            weight: 30,
            description: 'Trust Score Crítico (<200)',
            mitigatable: false
          }
        };
      }

      return { adjustedScore: currentRisk };
    } catch {
      return { adjustedScore: currentRisk };
    }
  },

  // ==========================================
  // HELPERS
  // ==========================================

  determineActionFromScore(score: number, context: OperationContext): { riskLevel: RiskLevel; requiredAction: AuthAction } {
    // Operaciones críticas siempre requieren step-up mínimo
    const criticalOps = ['change_password', 'change_email', 'change_phone', 'close_account'];
    if (criticalOps.includes(context.operation) && score < 50) {
      score = 50;
    }

    if (score <= RISK_THRESHOLDS.MINIMAL.max) {
      return { riskLevel: 'MINIMAL', requiredAction: 'ALLOW' };
    }
    if (score <= RISK_THRESHOLDS.LOW.max) {
      return { riskLevel: 'LOW', requiredAction: 'BIOMETRY' };
    }
    if (score <= RISK_THRESHOLDS.MEDIUM.max) {
      return { riskLevel: 'MEDIUM', requiredAction: 'OTP' };
    }
    if (score <= RISK_THRESHOLDS.HIGH.max) {
      return { riskLevel: 'HIGH', requiredAction: 'STEP_UP' };
    }

    // Critical: bloquear o review manual según contexto
    if (score >= 90) {
      return { riskLevel: 'CRITICAL', requiredAction: 'BLOCK' };
    }

    return { riskLevel: 'CRITICAL', requiredAction: 'MANUAL_REVIEW' };
  },

  calculateCooldown(riskScore: number): number {
    if (riskScore >= 90) return 60;  // 1 hora
    if (riskScore >= 80) return 30;  // 30 min
    if (riskScore >= 70) return 15;  // 15 min
    return 5;                        // 5 min
  },

  generateUserMessage(action: AuthAction, factors: RiskFactor[]): string {
    const mainFactor = factors.find(f => f.weight > 0)?.description || 'verificación de seguridad';

    switch (action) {
      case 'ALLOW':
        return '';
      case 'BIOMETRY':
        return 'Confirmá con tu huella o rostro para continuar.';
      case 'PIN':
        return 'Ingresá tu PIN de seguridad.';
      case 'OTP':
        return `Por ${mainFactor}, te enviamos un código de verificación.`;
      case '2FA':
        return 'Ingresá el código de tu app de autenticación.';
      case 'STEP_UP':
        return `Detectamos ${mainFactor}. Verificá tu identidad con biometría y código.`;
      case 'COOLDOWN':
        return 'Por seguridad, esperá unos minutos antes de intentar nuevamente.';
      case 'BLOCK':
        return 'Esta operación fue bloqueada por seguridad. Contactá a soporte si creés que es un error.';
      case 'MANUAL_REVIEW':
        return 'Esta operación requiere verificación adicional. Te contactaremos pronto.';
      default:
        return 'Verificación de seguridad requerida.';
    }
  },

  async isIPBlacklisted(ip: string): Promise<boolean> {
    const blacklisted = await prisma.ip_blacklist.findUnique({
      where: { ip_address: ip }
    });
    return !!blacklisted;
  },

  async detectVPNProxy(ip: string): Promise<boolean> {
    // Simplificado: verificar rangos conocidos de datacenters
    // En producción: usar servicio como IPQualityScore
    const datacenterRanges = [
      '104.16.', '104.17.', '104.18.',  // Cloudflare
      '34.', '35.',                      // Google Cloud
      '52.', '54.',                      // AWS
      '40.', '13.'                       // Azure
    ];

    return datacenterRanges.some(range => ip.startsWith(range));
  },

  async checkImpossibleTravel(userId: string, currentLocation: { lat: number; lng: number }): Promise<boolean> {
    // Obtener última ubicación conocida
    const lastSession = await prisma.user_sessions.findFirst({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' }
    });

    if (!lastSession || !lastSession.geo_location) return false;

    const lastLocation = lastSession.geo_location as { lat: number; lng: number };
    const timeDiffHours = (Date.now() - lastSession.created_at.getTime()) / (1000 * 60 * 60);

    // Calcular distancia
    const distance = this.calculateDistance(
      lastLocation.lat, lastLocation.lng,
      currentLocation.lat, currentLocation.lng
    );

    // Velocidad máxima posible: 900 km/h (avión)
    const maxDistance = timeDiffHours * 900;

    return distance > maxDistance;
  },

  calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; // Radio de la Tierra en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  },

  async getUserAverageAmount(userId: string, operation: string): Promise<number> {
    const typeMap: Record<string, string> = {
      'transfer_internal': 'TRANSFER_OUT',
      'transfer_external': 'TRANSFER_OUT',
      'transfer_new_recipient': 'TRANSFER_OUT',
      'withdraw': 'INVESTMENT_WITHDRAWAL'
    };

    const txType = typeMap[operation];
    if (!txType) return 0;

    const avg = await prisma.transactions.aggregate({
      where: {
        user_id: userId,
        type: txType,
        status: 'COMPLETED'
      },
      _avg: { amount: true }
    });

    return Number(avg._avg.amount) || 0;
  },

  async logRiskAssessment(
    context: OperationContext,
    score: number,
    level: RiskLevel,
    action: AuthAction,
    factors: RiskFactor[]
  ) {
    await prisma.risk_assessments.create({
      data: {
        user_id: context.userId,
        session_id: context.sessionId,
        operation: context.operation,
        risk_score: score,
        risk_level: level,
        required_action: action,
        risk_factors: factors as any,
        ip_address: context.ipAddress,
        device_fingerprint: context.deviceFingerprint,
        amount: context.amount ? new Prisma.Decimal(context.amount) : null,
        created_at: new Date()
      }
    });
  },

  // ==========================================
  // VERIFICAR SI PASO EL CHALLENGE
  // ==========================================

  async verifyChallenge(
    userId: string,
    sessionId: string,
    challengeType: AuthAction,
    response: { otp?: string; biometryPassed?: boolean; totpCode?: string }
  ): Promise<{ success: boolean; message: string }> {
    // Obtener assessment original
    const assessment = await prisma.risk_assessments.findFirst({
      where: {
        user_id: userId,
        session_id: sessionId
      },
      orderBy: { created_at: 'desc' }
    });

    if (!assessment) {
      return { success: false, message: 'Sesión no encontrada' };
    }

    switch (challengeType) {
      case 'BIOMETRY':
        if (response.biometryPassed) {
          await this.markChallengeCompleted(assessment.id);
          return { success: true, message: 'Verificación biométrica exitosa' };
        }
        return { success: false, message: 'Verificación biométrica fallida' };

      case 'OTP':
        // TODO: Verificar OTP real
        if (response.otp && response.otp.length === 6) {
          await this.markChallengeCompleted(assessment.id);
          return { success: true, message: 'Código verificado' };
        }
        return { success: false, message: 'Código inválido' };

      case '2FA':
      case 'STEP_UP':
        // Verificar TOTP
        if (response.totpCode && response.totpCode.length === 6) {
          // TODO: Verificar contra speakeasy
          await this.markChallengeCompleted(assessment.id);
          return { success: true, message: 'Verificación completa' };
        }
        return { success: false, message: 'Código 2FA inválido' };

      default:
        return { success: false, message: 'Tipo de challenge no soportado' };
    }
  },

  async markChallengeCompleted(assessmentId: string) {
    await prisma.risk_assessments.update({
      where: { id: assessmentId },
      data: { challenge_completed: true, completed_at: new Date() }
    });
  }
};
