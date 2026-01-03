import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================
// BEHAVIORAL ANALYTICS SERVICE
// Análisis profundo de comportamiento de usuarios
// ============================================

export interface UserBehaviorProfile {
  userId: string;
  
  // Patrones temporales
  temporal: {
    preferredHours: number[];           // Horas de mayor actividad
    preferredDays: number[];            // Días de mayor actividad
    avgSessionDuration: number;         // Minutos
    avgSessionsPerWeek: number;
    lastActiveAt: Date;
  };
  
  // Patrones transaccionales
  transactional: {
    avgTransactionAmount: number;
    medianTransactionAmount: number;
    maxTransactionAmount: number;
    avgTransactionsPerMonth: number;
    preferredTransactionTypes: string[];
    frequentRecipients: string[];
    avgTimeBetweenTransactions: number; // Horas
  };
  
  // Patrones de navegación
  navigation: {
    mostVisitedScreens: string[];
    avgScreenTime: Record<string, number>;
    featureAdoptionRate: number;        // % de features usadas
    searchPatterns: string[];
  };
  
  // Patrones de dispositivo
  device: {
    primaryPlatform: 'ios' | 'android' | 'web';
    deviceCount: number;
    avgDeviceAge: number;               // Días
    locationConsistency: number;        // 0-1
  };
  
  // Indicadores de riesgo
  riskIndicators: {
    unusualActivityScore: number;       // 0-100
    accountStabilityScore: number;      // 0-100
    verificationCompleteness: number;   // 0-100
    communicationEngagement: number;    // 0-100
  };
  
  // Segmentación
  segment: UserSegment;
  
  // Metadata
  profileVersion: number;
  lastUpdated: Date;
  dataPoints: number;
}

export type UserSegment = 
  | 'POWER_USER'      // Alta actividad, muchas features
  | 'REGULAR'         // Uso normal
  | 'PASSIVE'         // Bajo uso
  | 'DORMANT'         // Sin actividad reciente
  | 'NEW_USER'        // < 30 días
  | 'HIGH_VALUE'      // Alto volumen financiero
  | 'AT_RISK';        // Señales de abandono

export interface BehaviorAnomaly {
  userId: string;
  anomalyType: string;
  confidence: number;     // 0-100
  deviation: number;      // % de desviación del baseline
  description: string;
  detectedAt: Date;
  relatedData: any;
}

export const behavioralAnalyticsService = {
  // ==========================================
  // CONSTRUIR PERFIL DE COMPORTAMIENTO
  // ==========================================

  async buildProfile(userId: string): Promise<UserBehaviorProfile> {
    const [
      temporal,
      transactional,
      navigation,
      device,
      riskIndicators
    ] = await Promise.all([
      this.analyzeTemporalPatterns(userId),
      this.analyzeTransactionalPatterns(userId),
      this.analyzeNavigationPatterns(userId),
      this.analyzeDevicePatterns(userId),
      this.calculateRiskIndicators(userId)
    ]);

    const segment = this.determineSegment({
      temporal,
      transactional,
      device,
      riskIndicators
    });

    const profile: UserBehaviorProfile = {
      userId,
      temporal,
      transactional,
      navigation,
      device,
      riskIndicators,
      segment,
      profileVersion: 1,
      lastUpdated: new Date(),
      dataPoints: await this.countDataPoints(userId)
    };

    // Guardar perfil
    await this.saveProfile(profile);

    return profile;
  },

  // ==========================================
  // ANÁLISIS TEMPORAL
  // ==========================================

  async analyzeTemporalPatterns(userId: string) {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    // Obtener sesiones
    const sessions = await prisma.user_sessions.findMany({
      where: {
        user_id: userId,
        created_at: { gte: ninetyDaysAgo }
      },
      select: {
        created_at: true,
        ended_at: true
      }
    });

    if (sessions.length === 0) {
      return {
        preferredHours: [],
        preferredDays: [],
        avgSessionDuration: 0,
        avgSessionsPerWeek: 0,
        lastActiveAt: new Date(0)
      };
    }

    // Horas preferidas
    const hourCounts: Record<number, number> = {};
    const dayCounts: Record<number, number> = {};

    sessions.forEach(s => {
      const hour = s.created_at.getHours();
      const day = s.created_at.getDay();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      dayCounts[day] = (dayCounts[day] || 0) + 1;
    });

    // Top 5 horas
    const preferredHours = Object.entries(hourCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([h]) => parseInt(h));

    // Días con más del 10% de actividad
    const totalSessions = sessions.length;
    const preferredDays = Object.entries(dayCounts)
      .filter(([_, count]) => count > totalSessions * 0.1)
      .map(([d]) => parseInt(d));

    // Duración promedio de sesión
    const durations = sessions
      .filter(s => s.ended_at)
      .map(s => (s.ended_at!.getTime() - s.created_at.getTime()) / (1000 * 60));
    
    const avgSessionDuration = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;

    // Sesiones por semana
    const weeks = 90 / 7;
    const avgSessionsPerWeek = sessions.length / weeks;

    // Última actividad
    const lastSession = sessions.sort((a, b) => 
      b.created_at.getTime() - a.created_at.getTime()
    )[0];

    return {
      preferredHours,
      preferredDays,
      avgSessionDuration: Math.round(avgSessionDuration),
      avgSessionsPerWeek: Math.round(avgSessionsPerWeek * 10) / 10,
      lastActiveAt: lastSession?.created_at || new Date(0)
    };
  },

  // ==========================================
  // ANÁLISIS TRANSACCIONAL
  // ==========================================

  async analyzeTransactionalPatterns(userId: string) {
    const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);

    const transactions = await prisma.transactions.findMany({
      where: {
        user_id: userId,
        status: 'COMPLETED',
        created_at: { gte: sixMonthsAgo }
      },
      select: {
        amount: true,
        type: true,
        destination_cvu: true,
        created_at: true
      },
      orderBy: { created_at: 'asc' }
    });

    if (transactions.length === 0) {
      return {
        avgTransactionAmount: 0,
        medianTransactionAmount: 0,
        maxTransactionAmount: 0,
        avgTransactionsPerMonth: 0,
        preferredTransactionTypes: [],
        frequentRecipients: [],
        avgTimeBetweenTransactions: 0
      };
    }

    const amounts = transactions.map(t => Number(t.amount));
    
    // Estadísticas de monto
    const avgTransactionAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const sortedAmounts = [...amounts].sort((a, b) => a - b);
    const medianTransactionAmount = sortedAmounts[Math.floor(sortedAmounts.length / 2)];
    const maxTransactionAmount = Math.max(...amounts);

    // Transacciones por mes
    const months = 6;
    const avgTransactionsPerMonth = transactions.length / months;

    // Tipos preferidos
    const typeCounts: Record<string, number> = {};
    transactions.forEach(t => {
      typeCounts[t.type] = (typeCounts[t.type] || 0) + 1;
    });
    const preferredTransactionTypes = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type]) => type);

    // Destinatarios frecuentes
    const recipientCounts: Record<string, number> = {};
    transactions
      .filter(t => t.destination_cvu)
      .forEach(t => {
        recipientCounts[t.destination_cvu!] = (recipientCounts[t.destination_cvu!] || 0) + 1;
      });
    const frequentRecipients = Object.entries(recipientCounts)
      .filter(([_, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([cvu]) => cvu);

    // Tiempo promedio entre transacciones
    let totalTimeBetween = 0;
    for (let i = 1; i < transactions.length; i++) {
      totalTimeBetween += transactions[i].created_at.getTime() - transactions[i-1].created_at.getTime();
    }
    const avgTimeBetweenTransactions = transactions.length > 1
      ? (totalTimeBetween / (transactions.length - 1)) / (1000 * 60 * 60)
      : 0;

    return {
      avgTransactionAmount: Math.round(avgTransactionAmount),
      medianTransactionAmount: Math.round(medianTransactionAmount),
      maxTransactionAmount: Math.round(maxTransactionAmount),
      avgTransactionsPerMonth: Math.round(avgTransactionsPerMonth * 10) / 10,
      preferredTransactionTypes,
      frequentRecipients,
      avgTimeBetweenTransactions: Math.round(avgTimeBetweenTransactions * 10) / 10
    };
  },

  // ==========================================
  // ANÁLISIS DE NAVEGACIÓN
  // ==========================================

  async analyzeNavigationPatterns(userId: string) {
    // Obtener eventos de navegación (si existen)
    const events = await prisma.user_analytics_events.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: 1000
    });

    if (events.length === 0) {
      return {
        mostVisitedScreens: [],
        avgScreenTime: {},
        featureAdoptionRate: 0,
        searchPatterns: []
      };
    }

    // Pantallas más visitadas
    const screenCounts: Record<string, number> = {};
    events
      .filter(e => e.event_type === 'screen_view')
      .forEach(e => {
        const screen = (e.event_data as any)?.screen || 'unknown';
        screenCounts[screen] = (screenCounts[screen] || 0) + 1;
      });

    const mostVisitedScreens = Object.entries(screenCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([screen]) => screen);

    // Features usadas
    const allFeatures = ['transfer', 'invest', 'finance', 'qr', 'cards', 'services', 'rewards'];
    const usedFeatures = new Set(
      events
        .filter(e => e.event_type === 'feature_used')
        .map(e => (e.event_data as any)?.feature)
    );
    const featureAdoptionRate = (usedFeatures.size / allFeatures.length) * 100;

    // Búsquedas
    const searches = events
      .filter(e => e.event_type === 'search')
      .map(e => (e.event_data as any)?.query)
      .filter(Boolean)
      .slice(0, 10);

    return {
      mostVisitedScreens,
      avgScreenTime: {},
      featureAdoptionRate: Math.round(featureAdoptionRate),
      searchPatterns: searches
    };
  },

  // ==========================================
  // ANÁLISIS DE DISPOSITIVOS
  // ==========================================

  async analyzeDevicePatterns(userId: string) {
    const devices = await prisma.user_devices.findMany({
      where: { user_id: userId }
    });

    if (devices.length === 0) {
      return {
        primaryPlatform: 'unknown' as any,
        deviceCount: 0,
        avgDeviceAge: 0,
        locationConsistency: 0
      };
    }

    // Plataforma principal (más logins)
    const platformLogins: Record<string, number> = {};
    devices.forEach(d => {
      platformLogins[d.platform] = (platformLogins[d.platform] || 0) + d.login_count;
    });
    const primaryPlatform = Object.entries(platformLogins)
      .sort((a, b) => b[1] - a[1])[0]?.[0] as 'ios' | 'android' | 'web' || 'web';

    // Antigüedad promedio
    const ages = devices.map(d => 
      (Date.now() - d.first_seen_at.getTime()) / (1000 * 60 * 60 * 24)
    );
    const avgDeviceAge = ages.reduce((a, b) => a + b, 0) / ages.length;

    // Consistencia de ubicación (basada en IPs)
    const sessions = await prisma.user_sessions.findMany({
      where: { user_id: userId },
      select: { ip_address: true },
      take: 100
    });

    const uniqueIPs = new Set(sessions.map(s => s.ip_address)).size;
    const locationConsistency = Math.max(0, 1 - (uniqueIPs / Math.max(sessions.length, 1)));

    return {
      primaryPlatform,
      deviceCount: devices.length,
      avgDeviceAge: Math.round(avgDeviceAge),
      locationConsistency: Math.round(locationConsistency * 100) / 100
    };
  },

  // ==========================================
  // INDICADORES DE RIESGO
  // ==========================================

  async calculateRiskIndicators(userId: string) {
    const user = await prisma.users.findUnique({
      where: { id: userId },
      include: { account: true }
    });

    if (!user) {
      return {
        unusualActivityScore: 50,
        accountStabilityScore: 50,
        verificationCompleteness: 0,
        communicationEngagement: 0
      };
    }

    // Actividad inusual (basada en alertas recientes)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const alerts = await prisma.fraud_alerts.count({
      where: {
        user_id: userId,
        created_at: { gte: thirtyDaysAgo }
      }
    });
    const unusualActivityScore = Math.max(0, 100 - (alerts * 20));

    // Estabilidad de cuenta
    const accountAgeDays = (Date.now() - user.created_at.getTime()) / (1000 * 60 * 60 * 24);
    const hasBalance = Number(user.account?.balance) > 0;
    const accountStabilityScore = Math.min(100,
      (accountAgeDays > 180 ? 40 : accountAgeDays > 90 ? 30 : accountAgeDays > 30 ? 20 : 10) +
      (hasBalance ? 30 : 0) +
      (user.kyc_status === 'APPROVED' ? 30 : 0)
    );

    // Verificación completa
    let verificationPoints = 0;
    if (user.email_verified) verificationPoints += 20;
    if (user.phone_verified) verificationPoints += 20;
    if (user.kyc_status === 'APPROVED') verificationPoints += 40;
    if (user.address_street && user.address_city) verificationPoints += 10;
    if (user.birth_date) verificationPoints += 10;
    const verificationCompleteness = verificationPoints;

    // Engagement con comunicaciones
    const notifications = await prisma.user_notifications.findMany({
      where: { user_id: userId },
      select: { read: true },
      take: 50
    });
    const readRate = notifications.length > 0
      ? (notifications.filter(n => n.read).length / notifications.length) * 100
      : 50;
    const communicationEngagement = Math.round(readRate);

    return {
      unusualActivityScore,
      accountStabilityScore,
      verificationCompleteness,
      communicationEngagement
    };
  },

  // ==========================================
  // SEGMENTACIÓN
  // ==========================================

  determineSegment(data: {
    temporal: any;
    transactional: any;
    device: any;
    riskIndicators: any;
  }): UserSegment {
    const { temporal, transactional, riskIndicators } = data;

    // Nuevo usuario (sin datos suficientes)
    if (temporal.avgSessionsPerWeek === 0) {
      return 'NEW_USER';
    }

    // Dormant (sin actividad en 30+ días)
    const daysSinceActive = (Date.now() - new Date(temporal.lastActiveAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceActive > 30) {
      return 'DORMANT';
    }

    // At Risk (señales de abandono)
    if (riskIndicators.accountStabilityScore < 30 || daysSinceActive > 14) {
      return 'AT_RISK';
    }

    // High Value (alto volumen)
    if (transactional.avgTransactionAmount > 500000 || transactional.avgTransactionsPerMonth > 20) {
      return 'HIGH_VALUE';
    }

    // Power User (alta actividad + múltiples features)
    if (temporal.avgSessionsPerWeek >= 5 && transactional.preferredTransactionTypes.length >= 3) {
      return 'POWER_USER';
    }

    // Passive (baja actividad)
    if (temporal.avgSessionsPerWeek < 1) {
      return 'PASSIVE';
    }

    return 'REGULAR';
  },

  // ==========================================
  // DETECCIÓN DE ANOMALÍAS
  // ==========================================

  async detectAnomalies(userId: string, currentActivity: {
    action: string;
    amount?: number;
    timestamp: Date;
    metadata?: any;
  }): Promise<BehaviorAnomaly[]> {
    const anomalies: BehaviorAnomaly[] = [];

    // Obtener perfil
    const profile = await this.getProfile(userId);
    if (!profile) return anomalies;

    // Anomalía de horario
    const hour = currentActivity.timestamp.getHours();
    if (profile.temporal.preferredHours.length > 0 &&
        !profile.temporal.preferredHours.includes(hour)) {
      // Verificar si está muy fuera de rango
      const minPreferred = Math.min(...profile.temporal.preferredHours);
      const maxPreferred = Math.max(...profile.temporal.preferredHours);
      
      if (hour < minPreferred - 2 || hour > maxPreferred + 2) {
        anomalies.push({
          userId,
          anomalyType: 'UNUSUAL_TIME',
          confidence: 70,
          deviation: Math.abs(hour - ((minPreferred + maxPreferred) / 2)) / 12 * 100,
          description: `Actividad a las ${hour}:00, fuera del horario habitual (${minPreferred}:00-${maxPreferred}:00)`,
          detectedAt: new Date(),
          relatedData: { hour, preferredHours: profile.temporal.preferredHours }
        });
      }
    }

    // Anomalía de monto
    if (currentActivity.amount && profile.transactional.avgTransactionAmount > 0) {
      const deviation = ((currentActivity.amount - profile.transactional.avgTransactionAmount) / 
                         profile.transactional.avgTransactionAmount) * 100;
      
      if (deviation > 200) { // Más del 200% del promedio
        anomalies.push({
          userId,
          anomalyType: 'UNUSUAL_AMOUNT',
          confidence: Math.min(95, 50 + deviation / 10),
          deviation,
          description: `Monto $${currentActivity.amount} es ${deviation.toFixed(0)}% mayor al promedio ($${profile.transactional.avgTransactionAmount})`,
          detectedAt: new Date(),
          relatedData: { 
            amount: currentActivity.amount, 
            avgAmount: profile.transactional.avgTransactionAmount 
          }
        });
      }
    }

    // Anomalía de velocidad
    const recentTransactions = await prisma.transactions.count({
      where: {
        user_id: userId,
        created_at: { gte: new Date(Date.now() - 60 * 60 * 1000) }
      }
    });

    const expectedHourly = profile.transactional.avgTransactionsPerMonth / (30 * 24);
    if (recentTransactions > expectedHourly * 10) {
      anomalies.push({
        userId,
        anomalyType: 'VELOCITY_SPIKE',
        confidence: 85,
        deviation: ((recentTransactions - expectedHourly) / expectedHourly) * 100,
        description: `${recentTransactions} transacciones en 1 hora (esperado: ${expectedHourly.toFixed(1)})`,
        detectedAt: new Date(),
        relatedData: { recentCount: recentTransactions, expectedHourly }
      });
    }

    return anomalies;
  },

  // ==========================================
  // HELPERS
  // ==========================================

  async saveProfile(profile: UserBehaviorProfile): Promise<void> {
    await prisma.user_behavior_profiles.upsert({
      where: { user_id: profile.userId },
      create: {
        user_id: profile.userId,
        temporal: profile.temporal as any,
        transactional: profile.transactional as any,
        navigation: profile.navigation as any,
        device: profile.device as any,
        risk_indicators: profile.riskIndicators as any,
        segment: profile.segment,
        profile_version: profile.profileVersion,
        data_points: profile.dataPoints,
        updated_at: new Date()
      },
      update: {
        temporal: profile.temporal as any,
        transactional: profile.transactional as any,
        navigation: profile.navigation as any,
        device: profile.device as any,
        risk_indicators: profile.riskIndicators as any,
        segment: profile.segment,
        profile_version: { increment: 1 },
        data_points: profile.dataPoints,
        updated_at: new Date()
      }
    });
  },

  async getProfile(userId: string): Promise<UserBehaviorProfile | null> {
    const profile = await prisma.user_behavior_profiles.findUnique({
      where: { user_id: userId }
    });

    if (!profile) return null;

    return {
      userId: profile.user_id,
      temporal: profile.temporal as any,
      transactional: profile.transactional as any,
      navigation: profile.navigation as any,
      device: profile.device as any,
      riskIndicators: profile.risk_indicators as any,
      segment: profile.segment as UserSegment,
      profileVersion: profile.profile_version,
      lastUpdated: profile.updated_at,
      dataPoints: profile.data_points
    };
  },

  async countDataPoints(userId: string): Promise<number> {
    const [sessions, transactions, events] = await Promise.all([
      prisma.user_sessions.count({ where: { user_id: userId } }),
      prisma.transactions.count({ where: { user_id: userId } }),
      prisma.user_analytics_events.count({ where: { user_id: userId } })
    ]);

    return sessions + transactions + events;
  },

  // ==========================================
  // BATCH UPDATES
  // ==========================================

  async updateAllProfiles(): Promise<number> {
    const users = await prisma.users.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true }
    });

    let updated = 0;
    for (const user of users) {
      try {
        await this.buildProfile(user.id);
        updated++;
      } catch (e) {
        console.error(`Error updating profile for ${user.id}:`, e);
      }
    }

    return updated;
  }
};
