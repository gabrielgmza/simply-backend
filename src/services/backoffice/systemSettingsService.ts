import { PrismaClient } from '@prisma/client';
import { auditLogService } from './auditLogService';

const prisma = new PrismaClient();

// Valores por defecto del sistema
const DEFAULT_SETTINGS = {
  // Tasas
  'rates.fci_annual_rate': { value: '22.08', type: 'number', category: 'rates', description: 'Tasa anual de rendimiento FCI (%)' },
  'rates.fci_daily_rate': { value: '0.0605', type: 'number', category: 'rates', description: 'Tasa diaria de rendimiento FCI (%)' },
  'rates.penalty_rate': { value: '3', type: 'number', category: 'rates', description: 'Penalización por mora/drop (%)' },
  
  // Límites de financiación
  'limits.financing_percentage': { value: '15', type: 'number', category: 'limits', description: 'Porcentaje máximo de financiación sobre inversión (%)' },
  'limits.financing_min_amount': { value: '1000', type: 'number', category: 'limits', description: 'Monto mínimo de financiación (ARS)' },
  'limits.financing_min_installments': { value: '2', type: 'number', category: 'limits', description: 'Cuotas mínimas' },
  'limits.financing_max_installments': { value: '48', type: 'number', category: 'limits', description: 'Cuotas máximas' },
  
  // Límites de inversión
  'limits.investment_min_amount': { value: '1000', type: 'number', category: 'limits', description: 'Monto mínimo de inversión (ARS)' },
  
  // Límites de transferencia
  'limits.transfer_daily_default': { value: '500000', type: 'number', category: 'limits', description: 'Límite diario de transferencia por defecto (ARS)' },
  'limits.transfer_monthly_default': { value: '5000000', type: 'number', category: 'limits', description: 'Límite mensual de transferencia por defecto (ARS)' },
  
  // Comisiones
  'fees.transfer_rate': { value: '0.5', type: 'number', category: 'fees', description: 'Comisión por transferencia (%)' },
  'fees.card_physical_price': { value: '5000', type: 'number', category: 'fees', description: 'Costo tarjeta física (ARS)' },
  
  // Features
  'features.investments_enabled': { value: 'true', type: 'boolean', category: 'features', description: 'Inversiones habilitadas' },
  'features.financing_enabled': { value: 'true', type: 'boolean', category: 'features', description: 'Financiación habilitada' },
  'features.transfers_enabled': { value: 'true', type: 'boolean', category: 'features', description: 'Transferencias habilitadas' },
  'features.cards_enabled': { value: 'false', type: 'boolean', category: 'features', description: 'Tarjetas habilitadas' },
  'features.crypto_enabled': { value: 'false', type: 'boolean', category: 'features', description: 'Crypto onramp habilitado' },
  
  // Operaciones
  'operations.daily_returns_time': { value: '21:00', type: 'string', category: 'operations', description: 'Hora de acreditación de rendimientos' },
  'operations.installment_due_day': { value: '10', type: 'number', category: 'operations', description: 'Día de vencimiento de cuotas' },
  
  // Niveles
  'levels.plata_min': { value: '0', type: 'number', category: 'levels', description: 'Inversión mínima nivel Plata' },
  'levels.oro_min': { value: '100000', type: 'number', category: 'levels', description: 'Inversión mínima nivel Oro' },
  'levels.black_min': { value: '500000', type: 'number', category: 'levels', description: 'Inversión mínima nivel Black' },
  'levels.diamante_min': { value: '2000000', type: 'number', category: 'levels', description: 'Inversión mínima nivel Diamante' },
  
  // Aria AI
  'aria_enabled': { value: 'true', type: 'boolean', category: 'features', description: 'Habilitar Aria AI globalmente' },
  'aria_allowed_roles': { value: '["SUPER_ADMIN","ADMIN","COMPLIANCE","SUPPORT","FINANCE","OPERATIONS","RISK","AUDITOR","ANALYST"]', type: 'json', category: 'features', description: 'Roles con acceso a Aria' }
};

export const systemSettingsService = {
  // ============================================
  // INICIALIZAR CONFIGURACIÓN POR DEFECTO
  // ============================================
  async initializeDefaults() {
    for (const [key, config] of Object.entries(DEFAULT_SETTINGS)) {
      const existing = await prisma.system_settings.findUnique({
        where: { key }
      });
      
      if (!existing) {
        await prisma.system_settings.create({
          data: {
            key,
            value: config.value,
            value_type: config.type,
            category: config.category,
            description: config.description
          }
        });
      }
    }
    
    console.log('✅ System settings initialized');
  },

  // ============================================
  // OBTENER CONFIGURACIÓN
  // ============================================
  async get(key: string): Promise<string | null> {
    const setting = await prisma.system_settings.findUnique({
      where: { key }
    });
    return setting?.value || null;
  },

  async getNumber(key: string): Promise<number> {
    const value = await this.get(key);
    return value ? parseFloat(value) : 0;
  },

  async getBoolean(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value === 'true';
  },

  async getJSON(key: string): Promise<any> {
    const value = await this.get(key);
    try {
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  },

  // Obtener todas de una categoría
  async getByCategory(category: string) {
    return prisma.system_settings.findMany({
      where: { category },
      orderBy: { key: 'asc' }
    });
  },

  // Obtener todas
  async getAll() {
    const settings = await prisma.system_settings.findMany({
      orderBy: [{ category: 'asc' }, { key: 'asc' }]
    });

    // Agrupar por categoría
    const grouped: Record<string, any[]> = {};
    for (const setting of settings) {
      if (!grouped[setting.category]) {
        grouped[setting.category] = [];
      }
      grouped[setting.category].push({
        key: setting.key,
        value: setting.value,
        type: setting.value_type,
        description: setting.description,
        updatedAt: setting.updated_at
      });
    }

    return grouped;
  },

  // ============================================
  // ACTUALIZAR CONFIGURACIÓN
  // ============================================
  async set(
    key: string, 
    value: string, 
    employeeId: string, 
    employeeEmail: string,
    reason?: string
  ) {
    // Obtener valor anterior
    const current = await prisma.system_settings.findUnique({
      where: { key }
    });

    if (!current) {
      throw new Error(`Configuración '${key}' no encontrada`);
    }

    const oldValue = current.value;

    // Validar tipo
    if (current.value_type === 'number' && isNaN(parseFloat(value))) {
      throw new Error(`El valor debe ser numérico para '${key}'`);
    }
    
    if (current.value_type === 'boolean' && !['true', 'false'].includes(value)) {
      throw new Error(`El valor debe ser 'true' o 'false' para '${key}'`);
    }

    // Actualizar
    const updated = await prisma.system_settings.update({
      where: { key },
      data: {
        value,
        previous_value: oldValue,
        updated_by_id: employeeId
      }
    });

    // Guardar en historial
    await prisma.system_settings_history.create({
      data: {
        setting_key: key,
        old_value: oldValue,
        new_value: value,
        changed_by_id: employeeId,
        reason
      }
    });

    // Audit log
    await auditLogService.logSettingChange(
      employeeId,
      employeeEmail,
      key,
      oldValue,
      value,
      reason
    );

    return updated;
  },

  // Actualizar múltiples configuraciones
  async setMultiple(
    updates: { key: string; value: string }[],
    employeeId: string,
    employeeEmail: string,
    reason?: string
  ) {
    const results = [];
    
    for (const update of updates) {
      const result = await this.set(
        update.key, 
        update.value, 
        employeeId, 
        employeeEmail, 
        reason
      );
      results.push(result);
    }

    return results;
  },

  // ============================================
  // HISTORIAL
  // ============================================
  async getHistory(options: {
    key?: string;
    page?: number;
    limit?: number;
    dateFrom?: Date;
    dateTo?: Date;
  }) {
    const { key, page = 1, limit = 50, dateFrom, dateTo } = options;
    const skip = (page - 1) * limit;
    
    const where: any = {};
    if (key) where.setting_key = key;
    if (dateFrom || dateTo) {
      where.created_at = {};
      if (dateFrom) where.created_at.gte = dateFrom;
      if (dateTo) where.created_at.lte = dateTo;
    }

    const [history, total] = await Promise.all([
      prisma.system_settings_history.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' }
      }),
      prisma.system_settings_history.count({ where })
    ]);

    return {
      history,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  },

  // ============================================
  // SIMULACIÓN DE IMPACTO
  // ============================================
  async simulateImpact(key: string, newValue: string) {
    const current = await prisma.system_settings.findUnique({
      where: { key }
    });

    if (!current) {
      throw new Error(`Configuración '${key}' no encontrada`);
    }

    const currentVal = parseFloat(current.value);
    const newVal = parseFloat(newValue);
    
    let impact: any = {
      key,
      currentValue: current.value,
      newValue,
      type: current.value_type,
      description: current.description
    };

    // Calcular impacto según el tipo de configuración
    if (key === 'rates.fci_annual_rate') {
      // Obtener total invertido
      const totalInvested = await prisma.investments.aggregate({
        where: { status: 'ACTIVE' },
        _sum: { current_value: true }
      });
      
      const total = parseFloat(totalInvested._sum.current_value?.toString() || '0');
      const currentDailyReturn = total * (currentVal / 365 / 100);
      const newDailyReturn = total * (newVal / 365 / 100);
      
      impact.totalAffected = total;
      impact.currentDailyReturns = currentDailyReturn;
      impact.newDailyReturns = newDailyReturn;
      impact.dailyDifference = newDailyReturn - currentDailyReturn;
      impact.monthlyDifference = (newDailyReturn - currentDailyReturn) * 30;
    }
    
    if (key === 'limits.financing_percentage') {
      // Calcular nuevo crédito disponible total
      const totalInvested = await prisma.investments.aggregate({
        where: { status: 'ACTIVE' },
        _sum: { current_value: true }
      });
      
      const total = parseFloat(totalInvested._sum.current_value?.toString() || '0');
      const currentCredit = total * (currentVal / 100);
      const newCredit = total * (newVal / 100);
      
      impact.totalInvested = total;
      impact.currentTotalCredit = currentCredit;
      impact.newTotalCredit = newCredit;
      impact.creditDifference = newCredit - currentCredit;
    }

    if (key === 'rates.penalty_rate') {
      // Calcular impacto en financiaciones activas
      const activeFinancing = await prisma.financings.aggregate({
        where: { status: 'ACTIVE' },
        _sum: { remaining: true },
        _count: true
      });
      
      const totalRemaining = parseFloat(activeFinancing._sum.remaining?.toString() || '0');
      
      impact.activeFinancings = activeFinancing._count;
      impact.totalRemaining = totalRemaining;
      impact.currentPenalty = totalRemaining * (currentVal / 100);
      impact.newPenalty = totalRemaining * (newVal / 100);
    }

    return impact;
  },

  // ============================================
  // OBTENER VALORES ACTUALES CLAVE
  // ============================================
  async getCurrentRates() {
    const [fciRate, penaltyRate, financingPct, transferFee] = await Promise.all([
      this.getNumber('rates.fci_annual_rate'),
      this.getNumber('rates.penalty_rate'),
      this.getNumber('limits.financing_percentage'),
      this.getNumber('fees.transfer_rate')
    ]);

    return {
      fciAnnualRate: fciRate,
      fciDailyRate: fciRate / 365,
      penaltyRate,
      financingPercentage: financingPct,
      transferFeeRate: transferFee
    };
  },

  async getFeatureFlags() {
    const [investments, financing, transfers, cards, crypto] = await Promise.all([
      this.getBoolean('features.investments_enabled'),
      this.getBoolean('features.financing_enabled'),
      this.getBoolean('features.transfers_enabled'),
      this.getBoolean('features.cards_enabled'),
      this.getBoolean('features.crypto_enabled')
    ]);

    return {
      investments,
      financing,
      transfers,
      cards,
      crypto
    };
  }
};
