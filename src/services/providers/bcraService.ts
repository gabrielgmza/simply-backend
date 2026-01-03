import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================
// BCRA API Service
// Documentación: https://www.bcra.gob.ar/Catalogo/apis.asp
// ============================================

const BCRA_BASE_URL = 'https://api.bcra.gob.ar';

interface CotizacionUSD {
  fecha: string;
  valor: number;
}

interface DeudorInfo {
  cuit: string;
  denominacion: string;
  periodo: string;
  entidad: string;
  situacion: number;
  situacionDescripcion: string;
  monto: number;
  diasAtraso?: number;
  procesoJudicial: boolean;
  irrecuperable: boolean;
}

interface CentralDeudoresResponse {
  cuit: string;
  denominacion: string;
  periodos: {
    periodo: string;
    entidades: {
      entidad: string;
      situacion: number;
      monto: number;
      diasAtraso?: number;
      procesoJudicial: boolean;
      irrecuperable: boolean;
    }[];
  }[];
  resumen: {
    peorSituacion: number;
    montoTotal: number;
    cantidadEntidades: number;
  };
}

// Cache en memoria para cotizaciones (5 minutos)
let cotizacionCache: { valor: number; timestamp: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

export const bcraService = {
  // ==========================================
  // COTIZACIÓN USD
  // ==========================================

  // Obtener cotización USD oficial actual
  async getCotizacionUSD(): Promise<{ compra: number; venta: number; fecha: string }> {
    // Verificar cache
    if (cotizacionCache && Date.now() - cotizacionCache.timestamp < CACHE_TTL) {
      return {
        compra: cotizacionCache.valor * 0.99, // Spread estimado
        venta: cotizacionCache.valor,
        fecha: new Date().toISOString().split('T')[0]
      };
    }

    try {
      // API pública de BCRA - Tipo de cambio minorista
      const response = await fetch(`${BCRA_BASE_URL}/estadisticas/v2.0/DatosVariable/4/Ultimos/1`, {
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`BCRA API error: ${response.status}`);
      }

      const data = await response.json() as { results?: Array<{ fecha: string; valor: string }> };
      const resultado = data.results?.[0];

      if (!resultado) {
        throw new Error('Sin datos de cotización');
      }

      const valor = parseFloat(resultado.valor);
      
      // Actualizar cache
      cotizacionCache = { valor, timestamp: Date.now() };

      // Guardar en histórico
      await this.saveCotizacionHistorico(resultado.fecha, valor);

      return {
        compra: valor * 0.99,
        venta: valor,
        fecha: resultado.fecha
      };
    } catch (error: any) {
      console.error('Error obteniendo cotización BCRA:', error);
      
      // Fallback a último valor en DB
      const lastCotizacion = await prisma.cotizaciones_usd.findFirst({
        orderBy: { fecha: 'desc' }
      });

      if (lastCotizacion) {
        return {
          compra: Number(lastCotizacion.compra),
          venta: Number(lastCotizacion.venta),
          fecha: lastCotizacion.fecha.toISOString().split('T')[0]
        };
      }

      // Valor de emergencia
      return { compra: 1050, venta: 1060, fecha: new Date().toISOString().split('T')[0] };
    }
  },

  // Obtener histórico de cotizaciones
  async getCotizacionHistorico(dias: number = 30): Promise<CotizacionUSD[]> {
    try {
      const response = await fetch(
        `${BCRA_BASE_URL}/estadisticas/v2.0/DatosVariable/4/Ultimos/${dias}`,
        { headers: { 'Accept': 'application/json' } }
      );

      if (!response.ok) throw new Error(`BCRA API error: ${response.status}`);

      const data = await response.json() as { results?: Array<{ fecha: string; valor: string }> };
      return (data.results || []).map((r) => ({
        fecha: r.fecha,
        valor: parseFloat(r.valor)
      }));
    } catch (error) {
      // Fallback a DB
      const historico = await prisma.cotizaciones_usd.findMany({
        orderBy: { fecha: 'desc' },
        take: dias
      });
      return historico.map(h => ({
        fecha: h.fecha.toISOString().split('T')[0],
        valor: Number(h.venta)
      }));
    }
  },

  // Guardar cotización en histórico
  async saveCotizacionHistorico(fecha: string, valor: number): Promise<void> {
    const fechaDate = new Date(fecha);
    
    await prisma.cotizaciones_usd.upsert({
      where: { fecha: fechaDate },
      update: { venta: new Prisma.Decimal(valor), compra: new Prisma.Decimal(valor * 0.99) },
      create: {
        fecha: fechaDate,
        venta: new Prisma.Decimal(valor),
        compra: new Prisma.Decimal(valor * 0.99),
        source: 'BCRA'
      }
    });
  },

  // ==========================================
  // CENTRAL DE DEUDORES
  // ==========================================

  // Consultar situación crediticia por CUIT
  async consultarDeudor(cuit: string): Promise<CentralDeudoresResponse | null> {
    // Limpiar CUIT
    const cuitLimpio = cuit.replace(/[-\s]/g, '');
    
    if (!/^\d{11}$/.test(cuitLimpio)) {
      throw new Error('CUIT inválido - debe tener 11 dígitos');
    }

    try {
      // La API de Central de Deudores requiere autenticación
      // URL: https://api.bcra.gob.ar/CentralDeDeudores/v1.0/Deudas/{cuit}
      const response = await fetch(
        `${BCRA_BASE_URL}/CentralDeDeudores/v1.0/Deudas/${cuitLimpio}`,
        {
          headers: {
            'Accept': 'application/json',
            // Nota: En producción se requiere token de autenticación
          }
        }
      );

      if (response.status === 404) {
        return null; // Sin deudas registradas
      }

      if (!response.ok) {
        // Si la API no está disponible, intentar fallback
        console.warn('BCRA Central de Deudores no disponible, usando datos simulados');
        return this.getDeudorFromCache(cuitLimpio);
      }

      const data = await response.json();
      
      // Procesar y guardar resultado
      const resultado = this.procesarRespuestaDeudor(cuitLimpio, data);
      await this.saveDeudorConsulta(cuitLimpio, resultado);
      
      return resultado;
    } catch (error: any) {
      console.error('Error consultando Central de Deudores:', error);
      return this.getDeudorFromCache(cuitLimpio);
    }
  },

  // Procesar respuesta de Central de Deudores
  procesarRespuestaDeudor(cuit: string, data: any): CentralDeudoresResponse {
    const periodos: CentralDeudoresResponse['periodos'] = [];
    let peorSituacion = 1;
    let montoTotal = 0;
    const entidadesSet = new Set<string>();

    // La respuesta viene agrupada por período
    for (const periodo of (data.periodos || [])) {
      const entidades = [];
      
      for (const entidad of (periodo.entidades || [])) {
        const situacion = entidad.situacion || 1;
        const monto = parseFloat(entidad.monto || 0);
        
        if (situacion > peorSituacion) peorSituacion = situacion;
        montoTotal += monto;
        entidadesSet.add(entidad.entidad);

        entidades.push({
          entidad: entidad.entidad,
          situacion,
          monto,
          diasAtraso: entidad.diasAtraso,
          procesoJudicial: entidad.procesoJudicial || false,
          irrecuperable: situacion >= 5
        });
      }

      periodos.push({
        periodo: periodo.periodo,
        entidades
      });
    }

    return {
      cuit,
      denominacion: data.denominacion || '',
      periodos,
      resumen: {
        peorSituacion,
        montoTotal,
        cantidadEntidades: entidadesSet.size
      }
    };
  },

  // Obtener consulta previa de cache/DB
  async getDeudorFromCache(cuit: string): Promise<CentralDeudoresResponse | null> {
    const cached = await prisma.deudor_consultas.findFirst({
      where: { cuit },
      orderBy: { consulted_at: 'desc' }
    });

    if (cached && cached.resultado) {
      return cached.resultado as any;
    }

    return null;
  },

  // Guardar consulta de deudor
  async saveDeudorConsulta(cuit: string, resultado: CentralDeudoresResponse): Promise<void> {
    await prisma.deudor_consultas.create({
      data: {
        cuit,
        denominacion: resultado.denominacion,
        peor_situacion: resultado.resumen.peorSituacion,
        monto_total: new Prisma.Decimal(resultado.resumen.montoTotal),
        cantidad_entidades: resultado.resumen.cantidadEntidades,
        resultado: resultado as any,
        consulted_at: new Date()
      }
    });
  },

  // ==========================================
  // ANÁLISIS DE RIESGO CREDITICIO
  // ==========================================

  // Evaluar riesgo de un usuario por CUIT
  async evaluarRiesgoCrediticio(cuit: string): Promise<{
    aprobado: boolean;
    score: number;
    situacion: number;
    motivo: string;
    detalles?: CentralDeudoresResponse;
  }> {
    const deudor = await this.consultarDeudor(cuit);

    if (!deudor) {
      return {
        aprobado: true,
        score: 100,
        situacion: 1,
        motivo: 'Sin antecedentes crediticios negativos'
      };
    }

    const { peorSituacion, montoTotal, cantidadEntidades } = deudor.resumen;

    // Calcular score (100 = excelente, 0 = muy malo)
    let score = 100;
    
    // Penalizar por situación
    if (peorSituacion === 2) score -= 20;      // Con seguimiento especial
    else if (peorSituacion === 3) score -= 40; // Con problemas
    else if (peorSituacion === 4) score -= 60; // Alto riesgo de insolvencia
    else if (peorSituacion >= 5) score -= 80;  // Irrecuperable

    // Penalizar por monto de deuda
    if (montoTotal > 1000000) score -= 10;
    if (montoTotal > 5000000) score -= 10;

    // Penalizar por múltiples entidades
    if (cantidadEntidades > 3) score -= 5;
    if (cantidadEntidades > 5) score -= 5;

    score = Math.max(0, score);

    // Determinar aprobación
    const aprobado = peorSituacion <= 2 && score >= 50;

    let motivo = '';
    if (peorSituacion === 1) motivo = 'Situación normal';
    else if (peorSituacion === 2) motivo = 'Seguimiento especial - requiere revisión';
    else if (peorSituacion === 3) motivo = 'Con problemas - no elegible';
    else if (peorSituacion === 4) motivo = 'Alto riesgo - rechazado';
    else motivo = 'Irrecuperable - rechazado';

    return {
      aprobado,
      score,
      situacion: peorSituacion,
      motivo,
      detalles: deudor
    };
  },

  // ==========================================
  // DESCRIPCIONES DE SITUACIONES
  // ==========================================
  
  getSituacionDescripcion(situacion: number): string {
    const descripciones: Record<number, string> = {
      1: 'Normal - Cumplimiento normal',
      2: 'Con seguimiento especial - Atrasos menores',
      3: 'Con problemas - Atrasos mayores a 90 días',
      4: 'Alto riesgo de insolvencia - Atrasos mayores a 180 días',
      5: 'Irrecuperable - Deuda incobrable',
      6: 'Irrecuperable por disposición técnica'
    };
    return descripciones[situacion] || 'Desconocida';
  }
};
