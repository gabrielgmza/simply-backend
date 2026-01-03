import { PrismaClient, Prisma } from '@prisma/client';
import { trustScoreService } from './trustScoreService';
import { behavioralAnalyticsService } from './behavioralAnalyticsService';
import { auditLogService } from '../backoffice/auditLogService';

const prisma = new PrismaClient();

// ============================================
// ENHANCED FRAUD DETECTION SERVICE
// Sistema de ML para detección de fraude
// ============================================

export type FraudRiskLevel = 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type FraudDecision = 
  | 'APPROVE'           // Aprobar sin fricción
  | 'APPROVE_WITH_2FA'  // Aprobar con verificación
  | 'REVIEW'            // Enviar a revisión manual
  | 'HOLD'              // Retener temporalmente
  | 'DECLINE'           // Rechazar
  | 'BLOCK_USER';       // Bloquear usuario

export interface FraudEvaluation {
  transactionId?: string;
  userId: string;
  
  // Scores
  fraudScore: number;           // 0-100
  riskLevel: FraudRiskLevel;
  confidence: number;           // 0-100 (confianza del modelo)
  
  // Decisión
  decision: FraudDecision;
  decisionReason: string;
  
  // Factores
  riskFactors: FraudRiskFactor[];
  positiveFactors: FraudRiskFactor[];
  
  // ML Model info
  modelVersion: string;
  modelScores: {
    isolationForest: number;
    neuralNetwork: number;
    rulesEngine: number;
    velocityScore: number;
    behaviorScore: number;
  };
  
  // Recomendaciones
  recommendations: string[];
  
  // Metadata
  evaluatedAt: Date;
  processingTimeMs: number;
}

interface FraudRiskFactor {
  factor: string;
  weight: number;
  score: number;
  description: string;
  category: 'IDENTITY' | 'DEVICE' | 'BEHAVIOR' | 'TRANSACTION' | 'VELOCITY' | 'NETWORK';
}

interface TransactionContext {
  userId: string;
  type: string;
  amount: number;
  currency: string;
  destinationCvu?: string;
  destinationName?: string;
  ipAddress: string;
  deviceFingerprint?: string;
  sessionId: string;
  geoLocation?: { lat: number; lng: number; country: string; city: string };
  metadata?: Record<string, any>;
}

// Pesos de los modelos en el ensemble
const MODEL_WEIGHTS = {
  isolationForest: 0.25,
  neuralNetwork: 0.30,
  rulesEngine: 0.25,
  velocityScore: 0.10,
  behaviorScore: 0.10
};

// Thresholds de decisión
const DECISION_THRESHOLDS = {
  APPROVE: 20,
  APPROVE_WITH_2FA: 40,
  REVIEW: 60,
  HOLD: 80,
  DECLINE: 90
};

export const enhancedFraudService = {
  // ==========================================
  // EVALUAR TRANSACCIÓN
  // ==========================================

  async evaluateTransaction(context: TransactionContext): Promise<FraudEvaluation> {
    const startTime = Date.now();
    const riskFactors: FraudRiskFactor[] = [];
    const positiveFactors: FraudRiskFactor[] = [];

    // Ejecutar todos los modelos en paralelo
    const [
      isolationForestScore,
      neuralNetworkScore,
      rulesEngineResult,
      velocityResult,
      behaviorResult,
      trustScoreResult
    ] = await Promise.all([
      this.runIsolationForest(context),
      this.runNeuralNetwork(context),
      this.runRulesEngine(context, riskFactors, positiveFactors),
      this.calculateVelocityScore(context, riskFactors, positiveFactors),
      this.calculateBehaviorScore(context, riskFactors, positiveFactors),
      this.getTrustScoreAdjustment(context.userId)
    ]);

    // Calcular score del ensemble
    const modelScores = {
      isolationForest: isolationForestScore,
      neuralNetwork: neuralNetworkScore,
      rulesEngine: rulesEngineResult.score,
      velocityScore: velocityResult.score,
      behaviorScore: behaviorResult.score
    };

    let fraudScore = 
      modelScores.isolationForest * MODEL_WEIGHTS.isolationForest +
      modelScores.neuralNetwork * MODEL_WEIGHTS.neuralNetwork +
      modelScores.rulesEngine * MODEL_WEIGHTS.rulesEngine +
      modelScores.velocityScore * MODEL_WEIGHTS.velocityScore +
      modelScores.behaviorScore * MODEL_WEIGHTS.behaviorScore;

    // Ajustar por Trust Score
    fraudScore = this.applyTrustScoreAdjustment(fraudScore, trustScoreResult);

    // Normalizar
    fraudScore = Math.min(100, Math.max(0, fraudScore));

    // Calcular confianza
    const confidence = this.calculateConfidence(modelScores, riskFactors.length);

    // Determinar nivel de riesgo y decisión
    const riskLevel = this.getRiskLevel(fraudScore);
    const { decision, reason } = this.makeDecision(fraudScore, riskLevel, context, riskFactors);

    // Generar recomendaciones
    const recommendations = this.generateRecommendations(riskFactors, decision);

    const evaluation: FraudEvaluation = {
      userId: context.userId,
      fraudScore: Math.round(fraudScore),
      riskLevel,
      confidence: Math.round(confidence),
      decision,
      decisionReason: reason,
      riskFactors,
      positiveFactors,
      modelVersion: '2.0.0',
      modelScores,
      recommendations,
      evaluatedAt: new Date(),
      processingTimeMs: Date.now() - startTime
    };

    // Guardar evaluación
    await this.saveEvaluation(evaluation, context);

    // Si es alto riesgo, crear alerta
    if (fraudScore >= 60) {
      await this.createFraudAlert(evaluation, context);
    }

    return evaluation;
  },

  // ==========================================
  // MODELO: ISOLATION FOREST (Anomaly Detection)
  // ==========================================

  async runIsolationForest(context: TransactionContext): Promise<number> {
    // Simular Isolation Forest con heurísticas
    // En producción: usar modelo real entrenado
    
    let anomalyScore = 0;

    // Feature 1: Desviación del monto promedio
    const avgAmount = await this.getUserAverageAmount(context.userId);
    if (avgAmount > 0) {
      const deviation = Math.abs(context.amount - avgAmount) / avgAmount;
      anomalyScore += Math.min(30, deviation * 20);
    }

    // Feature 2: Frecuencia de transacciones
    const hourlyTx = await this.getHourlyTransactionCount(context.userId);
    if (hourlyTx > 5) {
      anomalyScore += Math.min(25, (hourlyTx - 5) * 5);
    }

    // Feature 3: Hora del día
    const hour = new Date().getHours();
    if (hour >= 0 && hour <= 5) {
      anomalyScore += 15;
    }

    // Feature 4: Nuevo destinatario
    if (context.destinationCvu) {
      const isNewRecipient = await this.isNewRecipient(context.userId, context.destinationCvu);
      if (isNewRecipient) {
        anomalyScore += 20;
      }
    }

    // Feature 5: Monto round (fraude suele usar montos redondos)
    if (context.amount % 1000 === 0 && context.amount >= 10000) {
      anomalyScore += 10;
    }

    return Math.min(100, anomalyScore);
  },

  // ==========================================
  // MODELO: NEURAL NETWORK (Pattern Recognition)
  // ==========================================

  async runNeuralNetwork(context: TransactionContext): Promise<number> {
    // Simular red neuronal con heurísticas avanzadas
    // En producción: usar TensorFlow.js o modelo serverless
    
    let nnScore = 0;

    // Pattern 1: Account takeover signals
    const recentPasswordChange = await this.hasRecentPasswordChange(context.userId);
    const recentEmailChange = await this.hasRecentEmailChange(context.userId);
    if (recentPasswordChange || recentEmailChange) {
      nnScore += 25;
    }

    // Pattern 2: Device switching
    const deviceSwitches = await this.countRecentDeviceSwitches(context.userId);
    if (deviceSwitches >= 3) {
      nnScore += 20;
    }

    // Pattern 3: Geographic anomaly
    if (context.geoLocation) {
      const geoAnomaly = await this.checkGeoAnomaly(context.userId, context.geoLocation);
      if (geoAnomaly) {
        nnScore += 30;
      }
    }

    // Pattern 4: Transaction pattern break
    const patternBreak = await this.detectPatternBreak(context);
    if (patternBreak) {
      nnScore += 25;
    }

    return Math.min(100, nnScore);
  },

  // ==========================================
  // MODELO: RULES ENGINE (Expert Rules)
  // ==========================================

  async runRulesEngine(
    context: TransactionContext, 
    riskFactors: FraudRiskFactor[],
    positiveFactors: FraudRiskFactor[]
  ): Promise<{ score: number }> {
    let score = 0;

    // Rule 1: Blacklisted IP
    const ipBlacklisted = await this.isIPBlacklisted(context.ipAddress);
    if (ipBlacklisted) {
      score += 50;
      riskFactors.push({
        factor: 'BLACKLISTED_IP',
        weight: 50,
        score: 50,
        description: 'IP en lista negra de fraude',
        category: 'NETWORK'
      });
    }

    // Rule 2: Monto alto + cuenta nueva
    const accountAgeDays = await this.getAccountAgeDays(context.userId);
    if (context.amount >= 500000 && accountAgeDays < 7) {
      score += 40;
      riskFactors.push({
        factor: 'HIGH_AMOUNT_NEW_ACCOUNT',
        weight: 40,
        score: 40,
        description: `Monto alto ($${context.amount}) en cuenta de ${accountAgeDays} días`,
        category: 'TRANSACTION'
      });
    }

    // Rule 3: Primera transacción internacional
    const isInternational = context.destinationCvu?.startsWith('00') === false;
    const hasInternationalHistory = await this.hasInternationalHistory(context.userId);
    if (isInternational && !hasInternationalHistory) {
      score += 25;
      riskFactors.push({
        factor: 'FIRST_INTERNATIONAL',
        weight: 25,
        score: 25,
        description: 'Primera transacción internacional',
        category: 'TRANSACTION'
      });
    }

    // Rule 4: Multiple failed attempts
    const failedAttempts = await this.getRecentFailedAttempts(context.userId);
    if (failedAttempts >= 3) {
      score += 30;
      riskFactors.push({
        factor: 'MULTIPLE_FAILURES',
        weight: 30,
        score: 30,
        description: `${failedAttempts} intentos fallidos recientes`,
        category: 'BEHAVIOR'
      });
    }

    // Rule 5: KYC no aprobado + monto alto
    const kycStatus = await this.getKYCStatus(context.userId);
    if (kycStatus !== 'APPROVED' && context.amount >= 100000) {
      score += 35;
      riskFactors.push({
        factor: 'UNVERIFIED_HIGH_AMOUNT',
        weight: 35,
        score: 35,
        description: 'Usuario no verificado con monto alto',
        category: 'IDENTITY'
      });
    }

    // Rule 6: Recipient en watchlist
    if (context.destinationCvu) {
      const recipientRisk = await this.checkRecipientRisk(context.destinationCvu);
      if (recipientRisk.isHighRisk) {
        score += 45;
        riskFactors.push({
          factor: 'HIGH_RISK_RECIPIENT',
          weight: 45,
          score: 45,
          description: `Destinatario de alto riesgo: ${recipientRisk.reason}`,
          category: 'TRANSACTION'
        });
      }
    }

    // Positive Rules
    // Rule +1: Cliente antiguo con buen historial
    if (accountAgeDays > 365) {
      score -= 15;
      positiveFactors.push({
        factor: 'ESTABLISHED_CUSTOMER',
        weight: -15,
        score: -15,
        description: 'Cliente establecido (>1 año)',
        category: 'IDENTITY'
      });
    }

    // Rule +2: Destinatario frecuente
    if (context.destinationCvu) {
      const isFrequent = await this.isFrequentRecipient(context.userId, context.destinationCvu);
      if (isFrequent) {
        score -= 20;
        positiveFactors.push({
          factor: 'FREQUENT_RECIPIENT',
          weight: -20,
          score: -20,
          description: 'Destinatario frecuente',
          category: 'TRANSACTION'
        });
      }
    }

    // Rule +3: Dispositivo confiable
    if (context.deviceFingerprint) {
      const deviceTrusted = await this.isDeviceTrusted(context.userId, context.deviceFingerprint);
      if (deviceTrusted) {
        score -= 15;
        positiveFactors.push({
          factor: 'TRUSTED_DEVICE',
          weight: -15,
          score: -15,
          description: 'Dispositivo de confianza',
          category: 'DEVICE'
        });
      }
    }

    return { score: Math.max(0, score) };
  },

  // ==========================================
  // VELOCITY SCORING
  // ==========================================

  async calculateVelocityScore(
    context: TransactionContext,
    riskFactors: FraudRiskFactor[],
    positiveFactors: FraudRiskFactor[]
  ): Promise<{ score: number }> {
    let score = 0;

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Velocity 1: Transacciones por hora
    const hourlyTx = await prisma.transactions.count({
      where: {
        user_id: context.userId,
        created_at: { gte: oneHourAgo }
      }
    });

    if (hourlyTx >= 10) {
      score += 40;
      riskFactors.push({
        factor: 'HIGH_HOURLY_VELOCITY',
        weight: 40,
        score: 40,
        description: `${hourlyTx} transacciones en 1 hora`,
        category: 'VELOCITY'
      });
    } else if (hourlyTx >= 5) {
      score += 20;
      riskFactors.push({
        factor: 'ELEVATED_HOURLY_VELOCITY',
        weight: 20,
        score: 20,
        description: `${hourlyTx} transacciones en 1 hora`,
        category: 'VELOCITY'
      });
    }

    // Velocity 2: Monto acumulado en 24h
    const dailyAmount = await prisma.transactions.aggregate({
      where: {
        user_id: context.userId,
        created_at: { gte: oneDayAgo },
        status: 'COMPLETED'
      },
      _sum: { amount: true }
    });

    const totalDaily = Number(dailyAmount._sum.amount) || 0;
    const user = await prisma.users.findUnique({ where: { id: context.userId } });
    const dailyLimit = user?.user_level === 'DIAMANTE' ? 5000000 : 
                       user?.user_level === 'BLACK' ? 2500000 :
                       user?.user_level === 'ORO' ? 1000000 : 500000;

    if (totalDaily + context.amount > dailyLimit * 0.9) {
      score += 25;
      riskFactors.push({
        factor: 'NEAR_DAILY_LIMIT',
        weight: 25,
        score: 25,
        description: `Cerca del límite diario (${((totalDaily + context.amount) / dailyLimit * 100).toFixed(0)}%)`,
        category: 'VELOCITY'
      });
    }

    // Velocity 3: Nuevos destinatarios en 24h
    const newRecipients = await this.countNewRecipientsInPeriod(context.userId, oneDayAgo);
    if (newRecipients >= 5) {
      score += 35;
      riskFactors.push({
        factor: 'MANY_NEW_RECIPIENTS',
        weight: 35,
        score: 35,
        description: `${newRecipients} nuevos destinatarios en 24h`,
        category: 'VELOCITY'
      });
    }

    return { score: Math.min(100, score) };
  },

  // ==========================================
  // BEHAVIOR SCORING
  // ==========================================

  async calculateBehaviorScore(
    context: TransactionContext,
    riskFactors: FraudRiskFactor[],
    positiveFactors: FraudRiskFactor[]
  ): Promise<{ score: number }> {
    let score = 0;

    // Obtener perfil de comportamiento
    const profile = await behavioralAnalyticsService.getProfile(context.userId);

    if (!profile) {
      // Sin perfil = usuario muy nuevo
      score += 30;
      riskFactors.push({
        factor: 'NO_BEHAVIOR_PROFILE',
        weight: 30,
        score: 30,
        description: 'Sin historial de comportamiento',
        category: 'BEHAVIOR'
      });
      return { score };
    }

    // Behavior 1: Transacción fuera de horario habitual
    const hour = new Date().getHours();
    if (profile.temporal.preferredHours.length > 0 &&
        !profile.temporal.preferredHours.includes(hour)) {
      const minHour = Math.min(...profile.temporal.preferredHours);
      const maxHour = Math.max(...profile.temporal.preferredHours);
      if (hour < minHour - 3 || hour > maxHour + 3) {
        score += 20;
        riskFactors.push({
          factor: 'OUT_OF_HOURS',
          weight: 20,
          score: 20,
          description: `Operación a las ${hour}:00 (habitual: ${minHour}-${maxHour}h)`,
          category: 'BEHAVIOR'
        });
      }
    }

    // Behavior 2: Monto muy superior al habitual
    if (profile.transactional.avgTransactionAmount > 0) {
      const deviation = (context.amount - profile.transactional.avgTransactionAmount) / 
                        profile.transactional.avgTransactionAmount;
      if (deviation > 3) {
        score += 30;
        riskFactors.push({
          factor: 'AMOUNT_DEVIATION',
          weight: 30,
          score: 30,
          description: `Monto ${(deviation * 100).toFixed(0)}% mayor al promedio`,
          category: 'BEHAVIOR'
        });
      } else if (deviation > 1.5) {
        score += 15;
        riskFactors.push({
          factor: 'AMOUNT_ELEVATED',
          weight: 15,
          score: 15,
          description: `Monto ${(deviation * 100).toFixed(0)}% mayor al promedio`,
          category: 'BEHAVIOR'
        });
      }
    }

    // Behavior 3: Segment check
    if (profile.segment === 'AT_RISK' || profile.segment === 'DORMANT') {
      score += 25;
      riskFactors.push({
        factor: 'RISKY_SEGMENT',
        weight: 25,
        score: 25,
        description: `Usuario en segmento ${profile.segment}`,
        category: 'BEHAVIOR'
      });
    }

    // Positive: Usuario power user o high value
    if (profile.segment === 'POWER_USER' || profile.segment === 'HIGH_VALUE') {
      score -= 15;
      positiveFactors.push({
        factor: 'VALUABLE_SEGMENT',
        weight: -15,
        score: -15,
        description: `Usuario ${profile.segment}`,
        category: 'BEHAVIOR'
      });
    }

    return { score: Math.max(0, score) };
  },

  // ==========================================
  // TRUST SCORE ADJUSTMENT
  // ==========================================

  async getTrustScoreAdjustment(userId: string): Promise<{ score: number; tier: string }> {
    try {
      const trustScore = await trustScoreService.getScore(userId);
      return { score: trustScore.globalScore, tier: trustScore.tier };
    } catch {
      return { score: 500, tier: 'MEDIUM' };
    }
  },

  applyTrustScoreAdjustment(fraudScore: number, trustResult: { score: number; tier: string }): number {
    // Trust Score alto reduce el fraud score
    if (trustResult.tier === 'ELITE') {
      return fraudScore * 0.7; // -30%
    }
    if (trustResult.tier === 'HIGH') {
      return fraudScore * 0.85; // -15%
    }
    if (trustResult.tier === 'LOW') {
      return fraudScore * 1.15; // +15%
    }
    if (trustResult.tier === 'CRITICAL') {
      return fraudScore * 1.3; // +30%
    }
    return fraudScore;
  },

  // ==========================================
  // DECISION MAKING
  // ==========================================

  getRiskLevel(score: number): FraudRiskLevel {
    if (score < 20) return 'MINIMAL';
    if (score < 40) return 'LOW';
    if (score < 60) return 'MEDIUM';
    if (score < 80) return 'HIGH';
    return 'CRITICAL';
  },

  makeDecision(
    score: number, 
    level: FraudRiskLevel, 
    context: TransactionContext,
    riskFactors: FraudRiskFactor[]
  ): { decision: FraudDecision; reason: string } {
    // Factores críticos que siempre bloquean
    const criticalFactors = riskFactors.filter(f => 
      f.factor === 'BLACKLISTED_IP' || 
      f.factor === 'HIGH_RISK_RECIPIENT'
    );

    if (criticalFactors.length > 0) {
      return {
        decision: 'DECLINE',
        reason: `Factor crítico: ${criticalFactors[0].description}`
      };
    }

    // Decisión por score
    if (score < DECISION_THRESHOLDS.APPROVE) {
      return { decision: 'APPROVE', reason: 'Transacción de bajo riesgo' };
    }

    if (score < DECISION_THRESHOLDS.APPROVE_WITH_2FA) {
      return { 
        decision: 'APPROVE_WITH_2FA', 
        reason: 'Riesgo moderado, requiere verificación' 
      };
    }

    if (score < DECISION_THRESHOLDS.REVIEW) {
      return { 
        decision: 'REVIEW', 
        reason: `Requiere revisión manual (score: ${score})` 
      };
    }

    if (score < DECISION_THRESHOLDS.HOLD) {
      return { 
        decision: 'HOLD', 
        reason: 'Alto riesgo, transacción retenida para análisis' 
      };
    }

    if (score < DECISION_THRESHOLDS.DECLINE) {
      return { 
        decision: 'DECLINE', 
        reason: 'Riesgo muy alto, transacción rechazada' 
      };
    }

    return { 
      decision: 'BLOCK_USER', 
      reason: 'Riesgo crítico, cuenta bloqueada preventivamente' 
    };
  },

  calculateConfidence(modelScores: any, factorCount: number): number {
    // Confianza basada en:
    // 1. Concordancia entre modelos
    const scores = Object.values(modelScores) as number[];
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - avg, 2), 0) / scores.length;
    const concordance = Math.max(0, 100 - variance);

    // 2. Cantidad de factores identificados
    const factorConfidence = Math.min(100, 50 + factorCount * 10);

    return (concordance * 0.6 + factorConfidence * 0.4);
  },

  generateRecommendations(riskFactors: FraudRiskFactor[], decision: FraudDecision): string[] {
    const recommendations: string[] = [];

    if (decision === 'APPROVE_WITH_2FA') {
      recommendations.push('Solicitar verificación 2FA antes de procesar');
    }

    if (decision === 'REVIEW') {
      recommendations.push('Asignar a analista de fraude para revisión manual');
      recommendations.push('Verificar identidad del cliente por teléfono');
    }

    if (decision === 'HOLD') {
      recommendations.push('Retener fondos por 24-48 horas');
      recommendations.push('Notificar al cliente sobre verificación en curso');
      recommendations.push('Escalar a equipo de compliance si involucra >$1M');
    }

    // Recomendaciones específicas por factor
    const velocityFactor = riskFactors.find(f => f.category === 'VELOCITY');
    if (velocityFactor) {
      recommendations.push('Implementar cooldown temporal para el usuario');
    }

    const deviceFactor = riskFactors.find(f => f.category === 'DEVICE');
    if (deviceFactor) {
      recommendations.push('Solicitar re-verificación de dispositivo');
    }

    return recommendations;
  },

  // ==========================================
  // HELPERS
  // ==========================================

  async getUserAverageAmount(userId: string): Promise<number> {
    const avg = await prisma.transactions.aggregate({
      where: { user_id: userId, status: 'COMPLETED' },
      _avg: { amount: true }
    });
    return Number(avg._avg.amount) || 0;
  },

  async getHourlyTransactionCount(userId: string): Promise<number> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    return prisma.transactions.count({
      where: { user_id: userId, created_at: { gte: oneHourAgo } }
    });
  },

  async isNewRecipient(userId: string, cvu: string): Promise<boolean> {
    const existing = await prisma.transactions.findFirst({
      where: { user_id: userId, destination_cvu: cvu, status: 'COMPLETED' }
    });
    return !existing;
  },

  async hasRecentPasswordChange(userId: string): Promise<boolean> {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const change = await prisma.audit_logs.findFirst({
      where: {
        resource_id: userId,
        action: 'PASSWORD_CHANGED',
        created_at: { gte: threeDaysAgo }
      }
    });
    return !!change;
  },

  async hasRecentEmailChange(userId: string): Promise<boolean> {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const change = await prisma.user_changes_history.findFirst({
      where: {
        user_id: userId,
        field_name: 'email',
        changed_at: { gte: threeDaysAgo }
      }
    });
    return !!change;
  },

  async countRecentDeviceSwitches(userId: string): Promise<number> {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sessions = await prisma.user_sessions.findMany({
      where: { user_id: userId, created_at: { gte: oneDayAgo } },
      select: { device_fingerprint: true },
      distinct: ['device_fingerprint']
    });
    return sessions.length;
  },

  async checkGeoAnomaly(userId: string, location: { lat: number; lng: number }): Promise<boolean> {
    // Simplificado: verificar si hay sesión reciente desde ubicación muy diferente
    return false; // Implementar con servicio de geolocalización
  },

  async detectPatternBreak(context: TransactionContext): Promise<boolean> {
    // Detectar si la transacción rompe el patrón histórico
    return false; // Implementar con análisis de series temporales
  },

  async isIPBlacklisted(ip: string): Promise<boolean> {
    const blacklisted = await prisma.ip_blacklist.findUnique({ where: { ip_address: ip } });
    return !!blacklisted;
  },

  async getAccountAgeDays(userId: string): Promise<number> {
    const user = await prisma.users.findUnique({ where: { id: userId } });
    if (!user) return 0;
    return (Date.now() - user.created_at.getTime()) / (1000 * 60 * 60 * 24);
  },

  async hasInternationalHistory(userId: string): Promise<boolean> {
    // Simplificado
    return false;
  },

  async getRecentFailedAttempts(userId: string): Promise<number> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    return prisma.transactions.count({
      where: {
        user_id: userId,
        status: 'FAILED',
        created_at: { gte: oneHourAgo }
      }
    });
  },

  async getKYCStatus(userId: string): Promise<string> {
    const user = await prisma.users.findUnique({ where: { id: userId } });
    return user?.kyc_status || 'PENDING';
  },

  async checkRecipientRisk(cvu: string): Promise<{ isHighRisk: boolean; reason?: string }> {
    const flagged = await prisma.flagged_accounts.findFirst({
      where: { cvu }
    });
    if (flagged) {
      return { isHighRisk: true, reason: flagged.reason };
    }
    return { isHighRisk: false };
  },

  async isFrequentRecipient(userId: string, cvu: string): Promise<boolean> {
    const contact = await prisma.contacts.findFirst({
      where: { user_id: userId, cvu, transfer_count: { gte: 3 } }
    });
    return !!contact;
  },

  async isDeviceTrusted(userId: string, fingerprint: string): Promise<boolean> {
    const device = await prisma.user_devices.findFirst({
      where: { user_id: userId, fingerprint, trust_level: 'TRUSTED' }
    });
    return !!device;
  },

  async countNewRecipientsInPeriod(userId: string, since: Date): Promise<number> {
    const recentTx = await prisma.transactions.findMany({
      where: {
        user_id: userId,
        created_at: { gte: since },
        destination_cvu: { not: null }
      },
      select: { destination_cvu: true },
      distinct: ['destination_cvu']
    });

    let newCount = 0;
    for (const tx of recentTx) {
      if (tx.destination_cvu) {
        const isNew = await this.isNewRecipient(userId, tx.destination_cvu);
        if (isNew) newCount++;
      }
    }
    return newCount;
  },

  // ==========================================
  // PERSISTENCE
  // ==========================================

  async saveEvaluation(evaluation: FraudEvaluation, context: TransactionContext): Promise<void> {
    await prisma.fraud_evaluations.create({
      data: {
        user_id: evaluation.userId,
        transaction_id: evaluation.transactionId,
        fraud_score: evaluation.fraudScore,
        risk_level: evaluation.riskLevel,
        confidence: evaluation.confidence,
        decision: evaluation.decision,
        decision_reason: evaluation.decisionReason,
        risk_factors: evaluation.riskFactors as any,
        positive_factors: evaluation.positiveFactors as any,
        model_version: evaluation.modelVersion,
        model_scores: evaluation.modelScores as any,
        recommendations: evaluation.recommendations,
        context: context as any,
        processing_time_ms: evaluation.processingTimeMs,
        evaluated_at: evaluation.evaluatedAt
      }
    });
  },

  async createFraudAlert(evaluation: FraudEvaluation, context: TransactionContext): Promise<void> {
    await prisma.fraud_alerts.create({
      data: {
        user_id: evaluation.userId,
        transaction_id: evaluation.transactionId,
        alert_type: evaluation.riskLevel === 'CRITICAL' ? 'HIGH_RISK_TRANSACTION' : 'SUSPICIOUS_TRANSACTION',
        severity: evaluation.riskLevel,
        fraud_score: evaluation.fraudScore,
        description: evaluation.decisionReason,
        risk_factors: evaluation.riskFactors as any,
        status: 'PENDING',
        auto_decision: evaluation.decision,
        context: context as any
      }
    });

    // Audit log
    await auditLogService.log({
      action: 'FRAUD_ALERT_CREATED',
      actorType: 'system',
      resource: 'fraud_alert',
      resourceId: evaluation.userId,
      description: `[${evaluation.riskLevel}] Score: ${evaluation.fraudScore} - ${evaluation.decisionReason}`,
      severity: evaluation.riskLevel === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
      metadata: { evaluation, context }
    });
  }
};
