import { PrismaClient, Prisma } from '@prisma/client';
import { auditLogService } from './backoffice/auditLogService';

const prisma = new PrismaClient();

// ============================================
// TRUST SCORE SIMPLY
// Score dinámico 0-1000 que determina beneficios
// ============================================

export interface TrustScoreComponents {
  identity: number;        // 0-200: KYC completeness, document quality
  financial: number;       // 0-200: Income consistency, savings pattern
  behavioral: number;      // 0-200: App usage, feature adoption
  transactional: number;   // 0-200: Payment history, defaults
  social: number;          // 0-200: Referrals, community engagement
}

export interface TrustScoreBenefits {
  financingLimitPercent: number;    // % del FCI disponible para financiar
  instantWithdrawal: boolean;       // Retiro sin delay
  reducedValidations: boolean;      // Menos fricciones en ops
  premiumSupport: boolean;          // Atención prioritaria
  higherLimits: boolean;            // Límites aumentados
  betaFeatures: boolean;            // Acceso a features nuevas
}

export interface TrustScoreResult {
  userId: string;
  globalScore: number;              // 0-1000
  tier: 'CRITICAL' | 'LOW' | 'MEDIUM' | 'HIGH' | 'ELITE';
  components: TrustScoreComponents;
  benefits: TrustScoreBenefits;
  factors: TrustScoreFactor[];
  lastCalculated: Date;
  trend: 'UP' | 'DOWN' | 'STABLE';
  nextReviewDate: Date;
}

interface TrustScoreFactor {
  factor: string;
  impact: number;        // Positivo o negativo
  description: string;
  category: keyof TrustScoreComponents;
}

// Pesos de cada componente
const COMPONENT_WEIGHTS = {
  identity: 0.25,       // 25%
  financial: 0.25,      // 25%
  behavioral: 0.15,     // 15%
  transactional: 0.25,  // 25%
  social: 0.10          // 10%
};

// Thresholds de tiers
const TIER_THRESHOLDS = {
  CRITICAL: 200,    // 0-199: Restricciones severas
  LOW: 400,         // 200-399: Restricciones moderadas
  MEDIUM: 600,      // 400-599: Operación normal
  HIGH: 800,        // 600-799: Beneficios básicos
  ELITE: 1001       // 800-1000: Todos los beneficios
};

// Beneficios por tier
const TIER_BENEFITS: Record<string, TrustScoreBenefits> = {
  CRITICAL: {
    financingLimitPercent: 0,
    instantWithdrawal: false,
    reducedValidations: false,
    premiumSupport: false,
    higherLimits: false,
    betaFeatures: false
  },
  LOW: {
    financingLimitPercent: 5,
    instantWithdrawal: false,
    reducedValidations: false,
    premiumSupport: false,
    higherLimits: false,
    betaFeatures: false
  },
  MEDIUM: {
    financingLimitPercent: 10,
    instantWithdrawal: false,
    reducedValidations: false,
    premiumSupport: false,
    higherLimits: false,
    betaFeatures: false
  },
  HIGH: {
    financingLimitPercent: 15,
    instantWithdrawal: true,
    reducedValidations: true,
    premiumSupport: false,
    higherLimits: true,
    betaFeatures: false
  },
  ELITE: {
    financingLimitPercent: 20,
    instantWithdrawal: true,
    reducedValidations: true,
    premiumSupport: true,
    higherLimits: true,
    betaFeatures: true
  }
};

export const trustScoreService = {
  // ==========================================
  // CALCULAR TRUST SCORE COMPLETO
  // ==========================================

  async calculateScore(userId: string): Promise<TrustScoreResult> {
    const user = await prisma.users.findUnique({
      where: { id: userId },
      include: { account: true }
    });

    if (!user) throw new Error('Usuario no encontrado');

    const factors: TrustScoreFactor[] = [];

    // Calcular cada componente
    const [identity, financial, behavioral, transactional, social] = await Promise.all([
      this.calculateIdentityScore(userId, user, factors),
      this.calculateFinancialScore(userId, user, factors),
      this.calculateBehavioralScore(userId, factors),
      this.calculateTransactionalScore(userId, factors),
      this.calculateSocialScore(userId, factors)
    ]);

    const components: TrustScoreComponents = {
      identity,
      financial,
      behavioral,
      transactional,
      social
    };

    // Calcular score global ponderado
    const globalScore = Math.round(
      (identity * COMPONENT_WEIGHTS.identity +
       financial * COMPONENT_WEIGHTS.financial +
       behavioral * COMPONENT_WEIGHTS.behavioral +
       transactional * COMPONENT_WEIGHTS.transactional +
       social * COMPONENT_WEIGHTS.social) * 5 // Escala a 1000
    );

    // Determinar tier
    const tier = this.getTierFromScore(globalScore);

    // Obtener beneficios
    const benefits = TIER_BENEFITS[tier];

    // Calcular tendencia
    const trend = await this.calculateTrend(userId, globalScore);

    // Guardar en DB
    await this.saveScore(userId, globalScore, components, tier);

    return {
      userId,
      globalScore,
      tier,
      components,
      benefits,
      factors,
      lastCalculated: new Date(),
      trend,
      nextReviewDate: new Date(Date.now() + 24 * 60 * 60 * 1000) // +1 día
    };
  },

  // ==========================================
  // COMPONENTE: IDENTITY (0-200)
  // ==========================================

  async calculateIdentityScore(userId: string, user: any, factors: TrustScoreFactor[]): Promise<number> {
    let score = 0;

    // KYC Status (0-80)
    switch (user.kyc_status) {
      case 'APPROVED':
        score += 80;
        factors.push({ factor: 'KYC_APPROVED', impact: 80, description: 'KYC completado y aprobado', category: 'identity' });
        break;
      case 'IN_PROGRESS':
        score += 30;
        factors.push({ factor: 'KYC_IN_PROGRESS', impact: 30, description: 'KYC en proceso', category: 'identity' });
        break;
      case 'PENDING':
        score += 10;
        factors.push({ factor: 'KYC_PENDING', impact: 10, description: 'KYC pendiente', category: 'identity' });
        break;
      case 'REJECTED':
        score -= 20;
        factors.push({ factor: 'KYC_REJECTED', impact: -20, description: 'KYC rechazado', category: 'identity' });
        break;
    }

    // Email verificado (0-20)
    if (user.email_verified) {
      score += 20;
      factors.push({ factor: 'EMAIL_VERIFIED', impact: 20, description: 'Email verificado', category: 'identity' });
    }

    // Teléfono verificado (0-30)
    if (user.phone_verified) {
      score += 30;
      factors.push({ factor: 'PHONE_VERIFIED', impact: 30, description: 'Teléfono verificado', category: 'identity' });
    }

    // Antigüedad de cuenta (0-40)
    const accountAgeDays = (Date.now() - user.created_at.getTime()) / (1000 * 60 * 60 * 24);
    if (accountAgeDays > 365) {
      score += 40;
      factors.push({ factor: 'ACCOUNT_AGE_1Y', impact: 40, description: 'Cuenta con más de 1 año', category: 'identity' });
    } else if (accountAgeDays > 180) {
      score += 30;
      factors.push({ factor: 'ACCOUNT_AGE_6M', impact: 30, description: 'Cuenta con más de 6 meses', category: 'identity' });
    } else if (accountAgeDays > 90) {
      score += 20;
      factors.push({ factor: 'ACCOUNT_AGE_3M', impact: 20, description: 'Cuenta con más de 3 meses', category: 'identity' });
    } else if (accountAgeDays > 30) {
      score += 10;
      factors.push({ factor: 'ACCOUNT_AGE_1M', impact: 10, description: 'Cuenta con más de 1 mes', category: 'identity' });
    }

    // Datos completos (0-30)
    const hasCompleteProfile = user.address_street && user.address_city && user.birth_date;
    if (hasCompleteProfile) {
      score += 30;
      factors.push({ factor: 'COMPLETE_PROFILE', impact: 30, description: 'Perfil completo', category: 'identity' });
    }

    return Math.min(200, Math.max(0, score));
  },

  // ==========================================
  // COMPONENTE: FINANCIAL (0-200)
  // ==========================================

  async calculateFinancialScore(userId: string, user: any, factors: TrustScoreFactor[]): Promise<number> {
    let score = 0;

    // Obtener inversiones
    const investments = await prisma.investments.aggregate({
      where: { user_id: userId, status: 'ACTIVE' },
      _sum: { current_value: true },
      _count: true
    });

    const totalInvested = Number(investments._sum.current_value) || 0;

    // Monto invertido (0-60)
    if (totalInvested >= 150000000) { // $150M+
      score += 60;
      factors.push({ factor: 'INVESTMENT_DIAMANTE', impact: 60, description: 'Inversión nivel Diamante', category: 'financial' });
    } else if (totalInvested >= 50000000) { // $50M+
      score += 50;
      factors.push({ factor: 'INVESTMENT_BLACK', impact: 50, description: 'Inversión nivel Black', category: 'financial' });
    } else if (totalInvested >= 10000000) { // $10M+
      score += 40;
      factors.push({ factor: 'INVESTMENT_ORO', impact: 40, description: 'Inversión nivel Oro', category: 'financial' });
    } else if (totalInvested >= 1000000) { // $1M+
      score += 25;
      factors.push({ factor: 'INVESTMENT_PLATA', impact: 25, description: 'Inversión nivel Plata', category: 'financial' });
    } else if (totalInvested > 0) {
      score += 10;
      factors.push({ factor: 'HAS_INVESTMENT', impact: 10, description: 'Tiene inversión activa', category: 'financial' });
    }

    // Consistencia de depósitos (últimos 3 meses) (0-50)
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const deposits = await prisma.transactions.groupBy({
      by: ['created_at'],
      where: {
        user_id: userId,
        type: 'TRANSFER_IN',
        status: 'COMPLETED',
        created_at: { gte: threeMonthsAgo }
      },
      _count: true
    });

    // Calcular meses con al menos 1 depósito
    const monthsWithDeposits = new Set(
      deposits.map(d => `${d.created_at.getFullYear()}-${d.created_at.getMonth()}`)
    ).size;

    if (monthsWithDeposits >= 3) {
      score += 50;
      factors.push({ factor: 'CONSISTENT_DEPOSITS', impact: 50, description: 'Depósitos consistentes (3 meses)', category: 'financial' });
    } else if (monthsWithDeposits >= 2) {
      score += 30;
      factors.push({ factor: 'REGULAR_DEPOSITS', impact: 30, description: 'Depósitos regulares', category: 'financial' });
    }

    // Permanencia de fondos (0-40)
    const avgBalance = await this.getAverageBalance(userId, 30);
    const currentBalance = Number(user.account?.balance) || 0;
    
    if (currentBalance > 0 && avgBalance > 0 && currentBalance >= avgBalance * 0.8) {
      score += 40;
      factors.push({ factor: 'STABLE_BALANCE', impact: 40, description: 'Balance estable (>80% del promedio)', category: 'financial' });
    } else if (currentBalance >= avgBalance * 0.5) {
      score += 20;
      factors.push({ factor: 'MODERATE_BALANCE', impact: 20, description: 'Balance moderado', category: 'financial' });
    }

    // Nivel de usuario (0-50)
    const levelBonus: Record<string, number> = {
      PLATA: 10,
      ORO: 25,
      BLACK: 40,
      DIAMANTE: 50
    };
    const bonus = levelBonus[user.user_level] || 0;
    if (bonus > 0) {
      score += bonus;
      factors.push({ factor: `LEVEL_${user.user_level}`, impact: bonus, description: `Nivel ${user.user_level}`, category: 'financial' });
    }

    return Math.min(200, Math.max(0, score));
  },

  // ==========================================
  // COMPONENTE: BEHAVIORAL (0-200)
  // ==========================================

  async calculateBehavioralScore(userId: string, factors: TrustScoreFactor[]): Promise<number> {
    let score = 50; // Base score

    // Frecuencia de uso (últimos 30 días)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const sessions = await prisma.user_sessions.count({
      where: {
        user_id: userId,
        created_at: { gte: thirtyDaysAgo }
      }
    });

    // Logins frecuentes (0-40)
    if (sessions >= 20) {
      score += 40;
      factors.push({ factor: 'VERY_ACTIVE', impact: 40, description: 'Usuario muy activo (20+ sesiones/mes)', category: 'behavioral' });
    } else if (sessions >= 10) {
      score += 30;
      factors.push({ factor: 'ACTIVE_USER', impact: 30, description: 'Usuario activo (10+ sesiones/mes)', category: 'behavioral' });
    } else if (sessions >= 4) {
      score += 15;
      factors.push({ factor: 'REGULAR_USER', impact: 15, description: 'Usuario regular', category: 'behavioral' });
    } else if (sessions === 0) {
      score -= 30;
      factors.push({ factor: 'INACTIVE_USER', impact: -30, description: 'Usuario inactivo', category: 'behavioral' });
    }

    // Diversidad de features usadas (0-50)
    const featureUsage = await prisma.transactions.groupBy({
      by: ['type'],
      where: {
        user_id: userId,
        created_at: { gte: thirtyDaysAgo }
      },
      _count: true
    });

    const featuresUsed = featureUsage.length;
    if (featuresUsed >= 5) {
      score += 50;
      factors.push({ factor: 'POWER_USER', impact: 50, description: 'Usa 5+ funcionalidades', category: 'behavioral' });
    } else if (featuresUsed >= 3) {
      score += 30;
      factors.push({ factor: 'DIVERSE_USAGE', impact: 30, description: 'Usa múltiples funcionalidades', category: 'behavioral' });
    } else if (featuresUsed >= 1) {
      score += 15;
      factors.push({ factor: 'BASIC_USAGE', impact: 15, description: 'Uso básico', category: 'behavioral' });
    }

    // Notificaciones push habilitadas (0-20)
    const user = await prisma.users.findUnique({ where: { id: userId } });
    if (user?.fcm_token) {
      score += 20;
      factors.push({ factor: 'PUSH_ENABLED', impact: 20, description: 'Notificaciones habilitadas', category: 'behavioral' });
    }

    // Sin intentos de bypass de seguridad (0-40)
    const securityIncidents = await prisma.fraud_alerts.count({
      where: {
        user_id: userId,
        alert_type: { in: ['BYPASS_ATTEMPT', 'SUSPICIOUS_BEHAVIOR'] },
        created_at: { gte: thirtyDaysAgo }
      }
    });

    if (securityIncidents === 0) {
      score += 40;
      factors.push({ factor: 'CLEAN_BEHAVIOR', impact: 40, description: 'Sin incidentes de seguridad', category: 'behavioral' });
    } else {
      score -= securityIncidents * 20;
      factors.push({ factor: 'SECURITY_INCIDENTS', impact: -securityIncidents * 20, description: `${securityIncidents} incidentes de seguridad`, category: 'behavioral' });
    }

    return Math.min(200, Math.max(0, score));
  },

  // ==========================================
  // COMPONENTE: TRANSACTIONAL (0-200)
  // ==========================================

  async calculateTransactionalScore(userId: string, factors: TrustScoreFactor[]): Promise<number> {
    let score = 50; // Base score

    // Historial de cuotas pagadas (0-80)
    const installments = await prisma.installments.groupBy({
      by: ['status'],
      where: {
        financing: { user_id: userId }
      },
      _count: true
    });

    const paid = installments.find(i => i.status === 'PAID')?._count || 0;
    const overdue = installments.find(i => i.status === 'OVERDUE')?._count || 0;
    const total = paid + overdue;

    if (total > 0) {
      const paymentRate = paid / total;
      if (paymentRate === 1 && paid >= 6) {
        score += 80;
        factors.push({ factor: 'PERFECT_PAYMENT', impact: 80, description: 'Historial de pago perfecto (6+ cuotas)', category: 'transactional' });
      } else if (paymentRate >= 0.95) {
        score += 60;
        factors.push({ factor: 'EXCELLENT_PAYMENT', impact: 60, description: 'Excelente historial de pago (>95%)', category: 'transactional' });
      } else if (paymentRate >= 0.8) {
        score += 40;
        factors.push({ factor: 'GOOD_PAYMENT', impact: 40, description: 'Buen historial de pago (>80%)', category: 'transactional' });
      } else {
        score -= 30;
        factors.push({ factor: 'POOR_PAYMENT', impact: -30, description: 'Historial de pago deficiente', category: 'transactional' });
      }
    }

    // Sin defaults activos (0-40 o -60)
    const activeDefaults = await prisma.installments.count({
      where: {
        financing: { user_id: userId, status: 'ACTIVE' },
        status: 'OVERDUE'
      }
    });

    if (activeDefaults === 0) {
      score += 40;
      factors.push({ factor: 'NO_DEFAULTS', impact: 40, description: 'Sin cuotas en mora', category: 'transactional' });
    } else {
      score -= activeDefaults * 20;
      factors.push({ factor: 'ACTIVE_DEFAULTS', impact: -activeDefaults * 20, description: `${activeDefaults} cuotas en mora`, category: 'transactional' });
    }

    // Volumen transaccional saludable (0-40)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const txVolume = await prisma.transactions.aggregate({
      where: {
        user_id: userId,
        status: 'COMPLETED',
        created_at: { gte: sixMonthsAgo }
      },
      _sum: { amount: true },
      _count: true
    });

    const txCount = txVolume._count || 0;
    if (txCount >= 50) {
      score += 40;
      factors.push({ factor: 'HIGH_VOLUME', impact: 40, description: 'Alto volumen transaccional', category: 'transactional' });
    } else if (txCount >= 20) {
      score += 25;
      factors.push({ factor: 'MODERATE_VOLUME', impact: 25, description: 'Volumen transaccional moderado', category: 'transactional' });
    } else if (txCount >= 5) {
      score += 10;
      factors.push({ factor: 'LOW_VOLUME', impact: 10, description: 'Volumen transaccional bajo', category: 'transactional' });
    }

    // Sin chargebacks/disputas (0-40)
    const disputes = await prisma.transactions.count({
      where: {
        user_id: userId,
        status: 'REVERSED'
      }
    });

    if (disputes === 0) {
      score += 40;
      factors.push({ factor: 'NO_DISPUTES', impact: 40, description: 'Sin disputas o reversiones', category: 'transactional' });
    } else {
      score -= disputes * 15;
      factors.push({ factor: 'HAS_DISPUTES', impact: -disputes * 15, description: `${disputes} transacciones revertidas`, category: 'transactional' });
    }

    return Math.min(200, Math.max(0, score));
  },

  // ==========================================
  // COMPONENTE: SOCIAL (0-200)
  // ==========================================

  async calculateSocialScore(userId: string, factors: TrustScoreFactor[]): Promise<number> {
    let score = 50; // Base score

    // Referidos exitosos (0-80)
    const referrals = await prisma.referrals.count({
      where: {
        referrer_id: userId,
        status: 'COMPLETED'
      }
    });

    if (referrals >= 10) {
      score += 80;
      factors.push({ factor: 'TOP_REFERRER', impact: 80, description: '10+ referidos exitosos', category: 'social' });
    } else if (referrals >= 5) {
      score += 50;
      factors.push({ factor: 'ACTIVE_REFERRER', impact: 50, description: '5+ referidos exitosos', category: 'social' });
    } else if (referrals >= 1) {
      score += 25;
      factors.push({ factor: 'HAS_REFERRALS', impact: 25, description: 'Tiene referidos', category: 'social' });
    }

    // Fue referido por usuario confiable (0-30)
    const wasReferred = await prisma.referrals.findFirst({
      where: { referred_id: userId, status: 'COMPLETED' },
      include: { referrer: true }
    });

    if (wasReferred) {
      const referrerScore = await this.getStoredScore(wasReferred.referrer_id);
      if (referrerScore && referrerScore >= 700) {
        score += 30;
        factors.push({ factor: 'TRUSTED_REFERRAL', impact: 30, description: 'Referido por usuario confiable', category: 'social' });
      } else if (referrerScore && referrerScore >= 500) {
        score += 15;
        factors.push({ factor: 'VALID_REFERRAL', impact: 15, description: 'Referido por usuario válido', category: 'social' });
      }
    }

    // Calificaciones positivas en soporte (0-40)
    const supportRatings = await prisma.support_tickets.aggregate({
      where: {
        user_id: userId,
        satisfaction_rating: { not: null }
      },
      _avg: { satisfaction_rating: true },
      _count: true
    });

    if (supportRatings._count > 0) {
      const avgRating = supportRatings._avg.satisfaction_rating || 0;
      if (avgRating >= 4.5) {
        score += 40;
        factors.push({ factor: 'EXCELLENT_FEEDBACK', impact: 40, description: 'Excelente feedback en soporte', category: 'social' });
      } else if (avgRating >= 4) {
        score += 25;
        factors.push({ factor: 'GOOD_FEEDBACK', impact: 25, description: 'Buen feedback en soporte', category: 'social' });
      }
    }

    // Engagement con contenido (0-50)
    const user = await prisma.users.findUnique({ where: { id: userId } });
    const prefs = user?.preferences as Record<string, any> || {};
    
    if (prefs.newsletter_subscribed) {
      score += 20;
      factors.push({ factor: 'NEWSLETTER_SUBSCRIBED', impact: 20, description: 'Suscrito a newsletter', category: 'social' });
    }

    if (prefs.app_review_given) {
      score += 30;
      factors.push({ factor: 'APP_REVIEWED', impact: 30, description: 'Dejó review de la app', category: 'social' });
    }

    return Math.min(200, Math.max(0, score));
  },

  // ==========================================
  // HELPERS
  // ==========================================

  getTierFromScore(score: number): 'CRITICAL' | 'LOW' | 'MEDIUM' | 'HIGH' | 'ELITE' {
    if (score < TIER_THRESHOLDS.CRITICAL) return 'CRITICAL';
    if (score < TIER_THRESHOLDS.LOW) return 'LOW';
    if (score < TIER_THRESHOLDS.MEDIUM) return 'MEDIUM';
    if (score < TIER_THRESHOLDS.HIGH) return 'HIGH';
    return 'ELITE';
  },

  async getAverageBalance(userId: string, days: number): Promise<number> {
    // Simplificado: usar balance actual como proxy
    const account = await prisma.accounts.findUnique({ where: { user_id: userId } });
    return Number(account?.balance) || 0;
  },

  async calculateTrend(userId: string, currentScore: number): Promise<'UP' | 'DOWN' | 'STABLE'> {
    const lastScore = await prisma.trust_scores.findFirst({
      where: { user_id: userId },
      orderBy: { calculated_at: 'desc' }
    });

    if (!lastScore) return 'STABLE';

    const diff = currentScore - lastScore.score;
    if (diff > 20) return 'UP';
    if (diff < -20) return 'DOWN';
    return 'STABLE';
  },

  async saveScore(userId: string, score: number, components: TrustScoreComponents, tier: string) {
    await prisma.trust_scores.create({
      data: {
        user_id: userId,
        score,
        tier,
        identity_score: components.identity,
        financial_score: components.financial,
        behavioral_score: components.behavioral,
        transactional_score: components.transactional,
        social_score: components.social,
        calculated_at: new Date()
      }
    });
  },

  async getStoredScore(userId: string): Promise<number | null> {
    const score = await prisma.trust_scores.findFirst({
      where: { user_id: userId },
      orderBy: { calculated_at: 'desc' }
    });
    return score?.score || null;
  },

  // ==========================================
  // API PÚBLICA
  // ==========================================

  async getScore(userId: string): Promise<TrustScoreResult> {
    // Verificar si hay score reciente (< 24h)
    const recentScore = await prisma.trust_scores.findFirst({
      where: {
        user_id: userId,
        calculated_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      },
      orderBy: { calculated_at: 'desc' }
    });

    if (recentScore) {
      const tier = this.getTierFromScore(recentScore.score);
      return {
        userId,
        globalScore: recentScore.score,
        tier,
        components: {
          identity: recentScore.identity_score,
          financial: recentScore.financial_score,
          behavioral: recentScore.behavioral_score,
          transactional: recentScore.transactional_score,
          social: recentScore.social_score
        },
        benefits: TIER_BENEFITS[tier],
        factors: [],
        lastCalculated: recentScore.calculated_at,
        trend: 'STABLE',
        nextReviewDate: new Date(recentScore.calculated_at.getTime() + 24 * 60 * 60 * 1000)
      };
    }

    // Calcular nuevo score
    return this.calculateScore(userId);
  },

  async forceRecalculate(userId: string): Promise<TrustScoreResult> {
    return this.calculateScore(userId);
  },

  async getScoreHistory(userId: string, limit: number = 30) {
    return prisma.trust_scores.findMany({
      where: { user_id: userId },
      orderBy: { calculated_at: 'desc' },
      take: limit
    });
  }
};
