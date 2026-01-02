// ============================================
// COMPLIANCE SERVICE - REPORTES UIF
// Simply Backend v3.2.0
// ============================================

import { PrismaClient, Prisma } from '@prisma/client';
import { auditLogService } from './auditLogService';

const prisma = new PrismaClient();

// Tipos
type ReportType = 'ROS' | 'ROE' | 'PERIODIC' | 'THRESHOLD';
type ReportStatus = 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'SUBMITTED' | 'REJECTED';

interface SuspiciousActivity {
  userId: string;
  transactionIds: string[];
  type: string;
  description: string;
  amount: number;
  indicators: string[];
}

// ============================================
// UIF REPORTING (Unidad de Información Financiera)
// ============================================

/**
 * Generar ROS (Reporte de Operación Sospechosa)
 */
async function generateROS(
  activity: SuspiciousActivity,
  employeeId: string
): Promise<any> {
  const user = await prisma.users.findUnique({
    where: { id: activity.userId },
    include: {
      account: true,
    },
  });

  if (!user) {
    throw new Error('Usuario no encontrado');
  }

  // Obtener transacciones involucradas
  const transactions = await prisma.transactions.findMany({
    where: { id: { in: activity.transactionIds } },
  });

  // Generar contenido del reporte
  const reportContent = {
    // Datos del sujeto obligado
    sujetoObligado: {
      cuit: process.env.COMPANY_CUIT || '30-00000000-0',
      razonSocial: 'PaySur S.A.',
      tipoSujeto: 'PSP', // Proveedor de Servicios de Pago
    },
    // Datos del cliente
    cliente: {
      tipo: 'PERSONA_FISICA',
      nombre: `${user.first_name} ${user.last_name}`,
      dni: user.dni,
      domicilio: `${user.address_street || ''} ${user.address_number || ''}, ${user.address_city || ''}, ${user.address_state || ''}`.trim(),
      email: user.email,
      telefono: user.phone,
    },
    // Operaciones reportadas
    operaciones: transactions.map(tx => ({
      fecha: tx.created_at,
      tipo: tx.type,
      monto: parseFloat(tx.amount.toString()),
      moneda: tx.currency,
      descripcion: tx.description,
    })),
    // Motivo del reporte
    motivo: {
      tipo: activity.type,
      descripcion: activity.description,
      indicadores: activity.indicators,
      montoTotal: activity.amount,
    },
    // Metadata
    fechaGeneracion: new Date(),
    generadoPor: employeeId,
  };

  // Crear reporte en base de datos
  const report = await prisma.compliance_reports.create({
    data: {
      type: 'ROS',
      user_id: activity.userId,
      status: 'DRAFT',
      content: reportContent as any,
      transaction_ids: activity.transactionIds,
      amount: activity.amount,
      created_by: employeeId,
    },
  });

  await auditLogService.log({
    actorType: 'employee',
    actorId: employeeId,
    action: 'create',
    resource: 'compliance_reports',
    resourceId: report.id,
    description: `ROS generado para usuario ${activity.userId}`,
    newData: { type: 'ROS', userId: activity.userId },
  });

  return report;
}

/**
 * Aprobar reporte
 */
async function approveReport(
  reportId: string,
  employeeId: string,
  notes?: string
): Promise<any> {
  const report = await prisma.compliance_reports.findUnique({
    where: { id: reportId },
  });

  if (!report) {
    throw new Error('Reporte no encontrado');
  }

  if (report.status !== 'PENDING_REVIEW') {
    throw new Error('El reporte debe estar en revisión para aprobar');
  }

  const updated = await prisma.compliance_reports.update({
    where: { id: reportId },
    data: {
      status: 'APPROVED',
      approved_by: employeeId,
      approved_at: new Date(),
      notes,
    },
  });

  await auditLogService.log({
    actorType: 'employee',
    actorId: employeeId,
    action: 'approve',
    resource: 'compliance_reports',
    resourceId: reportId,
    description: 'Reporte de compliance aprobado',
  });

  return updated;
}

/**
 * Enviar reporte a UIF
 */
async function submitReport(
  reportId: string,
  employeeId: string
): Promise<any> {
  const report = await prisma.compliance_reports.findUnique({
    where: { id: reportId },
  });

  if (!report) {
    throw new Error('Reporte no encontrado');
  }

  if (report.status !== 'APPROVED') {
    throw new Error('El reporte debe estar aprobado para enviar');
  }

  // TODO: Integración real con API de UIF
  // Por ahora simulamos el envío
  const uifReference = `UIF-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const updated = await prisma.compliance_reports.update({
    where: { id: reportId },
    data: {
      status: 'SUBMITTED',
      submitted_at: new Date(),
      submitted_by: employeeId,
      external_reference: uifReference,
    },
  });

  await auditLogService.log({
    actorType: 'employee',
    actorId: employeeId,
    action: 'submit',
    resource: 'compliance_reports',
    resourceId: reportId,
    description: `Reporte enviado a UIF - Ref: ${uifReference}`,
    newData: { uifReference },
  });

  return updated;
}

// ============================================
// THRESHOLD MONITORING
// ============================================

/**
 * Verificar operaciones que superan umbrales
 */
async function checkThresholds(date?: Date): Promise<{
  overThreshold: any[];
  nearThreshold: any[];
}> {
  const checkDate = date || new Date();
  const startOfDay = new Date(checkDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(checkDate);
  endOfDay.setHours(23, 59, 59, 999);

  // Umbral UIF para reportar: $600,000 ARS (actualizar según normativa vigente)
  const THRESHOLD_ARS = 600000;
  const NEAR_THRESHOLD_PCT = 0.8; // 80%

  // Sumar operaciones por usuario del día
  const userOperations = await prisma.transactions.groupBy({
    by: ['account_id'],
    where: {
      created_at: { gte: startOfDay, lte: endOfDay },
      status: 'COMPLETED',
      currency: 'ARS',
    },
    _sum: { amount: true },
  });

  const overThreshold: any[] = [];
  const nearThreshold: any[] = [];

  for (const op of userOperations) {
    const total = parseFloat(op._sum.amount?.toString() || '0');
    
    if (total >= THRESHOLD_ARS) {
      const account = await prisma.accounts.findUnique({
        where: { id: op.account_id },
        include: { user: true },
      });
      
      overThreshold.push({
        accountId: op.account_id,
        userId: account?.user_id,
        userName: `${account?.user?.first_name} ${account?.user?.last_name}`,
        email: account?.user?.email,
        total,
        threshold: THRESHOLD_ARS,
        date: checkDate,
      });
    } else if (total >= THRESHOLD_ARS * NEAR_THRESHOLD_PCT) {
      nearThreshold.push({
        accountId: op.account_id,
        total,
        percentage: (total / THRESHOLD_ARS * 100).toFixed(1),
      });
    }
  }

  return { overThreshold, nearThreshold };
}

/**
 * Generar reporte automático por umbral
 */
async function generateThresholdReport(
  accountId: string,
  date: Date,
  systemEmployeeId: string
): Promise<any> {
  const account = await prisma.accounts.findUnique({
    where: { id: accountId },
    include: { user: true },
  });

  if (!account || !account.user) {
    throw new Error('Cuenta no encontrada');
  }

  // Obtener transacciones del día
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const transactions = await prisma.transactions.findMany({
    where: {
      account_id: accountId,
      created_at: { gte: startOfDay, lte: endOfDay },
      status: 'COMPLETED',
    },
  });

  const totalAmount = transactions.reduce(
    (sum, tx) => sum + parseFloat(tx.amount.toString()),
    0
  );

  // Crear reporte automático
  const report = await prisma.compliance_reports.create({
    data: {
      type: 'THRESHOLD',
      user_id: account.user_id,
      status: 'PENDING_REVIEW',
      content: {
        tipo: 'OPERACION_UMBRAL',
        fecha: date,
        cliente: {
          nombre: `${account.user.first_name} ${account.user.last_name}`,
          dni: account.user.dni,
          email: account.user.email,
        },
        operaciones: transactions.map(tx => ({
          id: tx.id,
          fecha: tx.created_at,
          tipo: tx.type,
          monto: parseFloat(tx.amount.toString()),
        })),
        montoTotal: totalAmount,
        generadoAutomaticamente: true,
      } as any,
      transaction_ids: transactions.map(tx => tx.id),
      amount: totalAmount,
      created_by: systemEmployeeId,
    },
  });

  await auditLogService.log({
    actorType: 'system',
    action: 'create',
    resource: 'compliance_reports',
    resourceId: report.id,
    description: `Reporte automático por umbral - Usuario ${account.user_id}`,
    newData: { type: 'THRESHOLD', amount: totalAmount },
  });

  return report;
}

// ============================================
// KYC/AML COMPLIANCE
// ============================================

/**
 * Obtener estado de compliance del usuario
 */
async function getUserComplianceStatus(userId: string): Promise<{
  kycStatus: string;
  pepStatus: boolean;
  sanctionsStatus: boolean;
  riskLevel: string;
  lastReview: Date | null;
  pendingActions: string[];
  reports: any[];
}> {
  const user = await prisma.users.findUnique({
    where: { id: userId },
    include: {
      account: true,
    },
  });

  if (!user) {
    throw new Error('Usuario no encontrado');
  }

  // Obtener risk flags activos
  const riskFlags = await prisma.risk_flags.findMany({
    where: { user_id: userId, status: 'active' },
  });

  // Obtener reportes
  const reports = await prisma.compliance_reports.findMany({
    where: { user_id: userId },
    orderBy: { created_at: 'desc' },
    take: 10,
  });

  // Determinar nivel de riesgo
  let riskLevel = 'LOW';
  if (riskFlags.some(f => f.severity === 'critical')) riskLevel = 'CRITICAL';
  else if (riskFlags.some(f => f.severity === 'high')) riskLevel = 'HIGH';
  else if (riskFlags.some(f => f.severity === 'medium')) riskLevel = 'MEDIUM';

  // Acciones pendientes
  const pendingActions: string[] = [];
  if (user.kyc_status !== 'APPROVED') pendingActions.push('Completar KYC');
  if (!user.dni) pendingActions.push('Validar DNI');

  return {
    kycStatus: user.kyc_status,
    pepStatus: false, // TODO: Integrar con base de datos PEP
    sanctionsStatus: false, // TODO: Integrar con listas de sanciones
    riskLevel,
    lastReview: null, // TODO: Tracking de revisiones
    pendingActions,
    reports,
  };
}

/**
 * Programar revisión periódica de usuario
 */
async function scheduleUserReview(
  userId: string,
  reason: string,
  employeeId: string
): Promise<any> {
  const review = await prisma.compliance_reviews.create({
    data: {
      user_id: userId,
      reason,
      status: 'PENDING',
      scheduled_by: employeeId,
      due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 días
    },
  });

  await auditLogService.log({
    actorType: 'employee',
    actorId: employeeId,
    action: 'create',
    resource: 'compliance_reviews',
    resourceId: review.id,
    description: `Revisión programada para usuario ${userId}`,
  });

  return review;
}

// ============================================
// REPORTS & STATISTICS
// ============================================

/**
 * Obtener estadísticas de compliance
 */
async function getComplianceStats(days: number = 30): Promise<{
  totalReports: number;
  byType: { type: string; count: number }[];
  byStatus: { status: string; count: number }[];
  pendingReviews: number;
  thresholdBreaches: number;
  avgProcessingTime: number;
}> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const [totalReports, byType, byStatus, pendingReviews] = await Promise.all([
    prisma.compliance_reports.count({
      where: { created_at: { gte: since } },
    }),
    prisma.compliance_reports.groupBy({
      by: ['type'],
      where: { created_at: { gte: since } },
      _count: true,
    }),
    prisma.compliance_reports.groupBy({
      by: ['status'],
      where: { created_at: { gte: since } },
      _count: true,
    }),
    prisma.compliance_reviews.count({
      where: { status: 'PENDING' },
    }),
  ]);

  // Threshold breaches
  const thresholdReports = await prisma.compliance_reports.count({
    where: { created_at: { gte: since }, type: 'THRESHOLD' },
  });

  // Calcular tiempo promedio de procesamiento
  const submittedReports = await prisma.compliance_reports.findMany({
    where: {
      created_at: { gte: since },
      submitted_at: { not: null },
    },
    select: { created_at: true, submitted_at: true },
  });

  let avgProcessingTime = 0;
  if (submittedReports.length > 0) {
    const totalTime = submittedReports.reduce((sum, r) => {
      return sum + (r.submitted_at!.getTime() - r.created_at.getTime());
    }, 0);
    avgProcessingTime = totalTime / submittedReports.length / (1000 * 60 * 60); // En horas
  }

  return {
    totalReports,
    byType: byType.map(t => ({ type: t.type, count: t._count })),
    byStatus: byStatus.map(s => ({ status: s.status, count: s._count })),
    pendingReviews,
    thresholdBreaches: thresholdReports,
    avgProcessingTime: Math.round(avgProcessingTime * 10) / 10,
  };
}

/**
 * Listar reportes
 */
async function listReports(options: {
  page?: number;
  limit?: number;
  type?: ReportType;
  status?: ReportStatus;
  userId?: string;
  from?: Date;
  to?: Date;
} = {}): Promise<{ reports: any[]; total: number }> {
  const { page = 1, limit = 20, type, status, userId, from, to } = options;

  const where: any = {};
  if (type) where.type = type;
  if (status) where.status = status;
  if (userId) where.user_id = userId;
  if (from || to) {
    where.created_at = {};
    if (from) where.created_at.gte = from;
    if (to) where.created_at.lte = to;
  }

  const [reports, total] = await Promise.all([
    prisma.compliance_reports.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        users: {
          select: { id: true, email: true, first_name: true, last_name: true, dni: true },
        },
      },
    }),
    prisma.compliance_reports.count({ where }),
  ]);

  return { reports, total };
}

/**
 * Listar revisiones pendientes
 */
async function listPendingReviews(options: {
  page?: number;
  limit?: number;
} = {}): Promise<{ reviews: any[]; total: number }> {
  const { page = 1, limit = 20 } = options;

  const where = { status: 'PENDING' };

  const [reviews, total] = await Promise.all([
    prisma.compliance_reviews.findMany({
      where,
      orderBy: { due_date: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        users: {
          select: { id: true, email: true, first_name: true, last_name: true },
        },
      },
    }),
    prisma.compliance_reviews.count({ where }),
  ]);

  return { reviews, total };
}

// ============================================
// EXPORTS
// ============================================

export const complianceService = {
  // UIF Reporting
  generateROS,
  approveReport,
  submitReport,
  
  // Threshold Monitoring
  checkThresholds,
  generateThresholdReport,
  
  // KYC/AML
  getUserComplianceStatus,
  scheduleUserReview,
  
  // Reports & Stats
  getComplianceStats,
  listReports,
  listPendingReviews,
};
