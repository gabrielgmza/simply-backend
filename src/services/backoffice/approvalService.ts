import { PrismaClient } from '@prisma/client';
import { auditLogService } from './auditLogService';

const prisma = new PrismaClient();

// ============================================
// CONFIGURACIÓN DE THRESHOLDS
// ============================================

const APPROVAL_CONFIG = {
  // Thresholds por monto (ARS)
  thresholds: [
    { maxAmount: 50000, requiredApprovals: 1, roles: ['ADMIN', 'COMPLIANCE'] },
    { maxAmount: 200000, requiredApprovals: 1, roles: ['ADMIN'] },
    { maxAmount: 500000, requiredApprovals: 2, roles: ['ADMIN', 'SUPER_ADMIN'] },
    { maxAmount: Infinity, requiredApprovals: 2, roles: ['SUPER_ADMIN'] }
  ],
  
  // Operaciones que siempre requieren aprobación
  sensitiveOperations: [
    'user_block',
    'investment_liquidate',
    'financing_liquidate',
    'limit_increase',
    'treasury_withdraw',
    'otc_execute',
    'employee_delete',
    'settings_critical'
  ],
  
  // Tiempo de expiración (horas)
  expirationHours: 24
};

// ============================================
// TIPOS
// ============================================

interface CreateApprovalRequest {
  resourceType: string;
  resourceId: string;
  operationType: string;
  makerId: string;
  payload: any;
  amount?: number;
  reason?: string;
}

interface ApprovalDecisionInput {
  requestId: string;
  checkerId: string;
  decision: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES';
  comments?: string;
  ipAddress?: string;
}

// ============================================
// APPROVAL SERVICE
// ============================================

export const approvalService = {
  // -------------------------------------------
  // CREAR SOLICITUD DE APROBACIÓN
  // -------------------------------------------
  
  async createRequest(input: CreateApprovalRequest) {
    const { resourceType, resourceId, operationType, makerId, payload, amount, reason } = input;
    
    // 1. Determinar requisitos de aprobación
    const requirements = this.determineApprovalRequirements(operationType, amount);
    
    // 2. Crear la solicitud
    const request = await prisma.approval_requests.create({
      data: {
        resource_type: resourceType,
        resource_id: resourceId,
        operation_type: operationType,
        maker_id: makerId,
        payload,
        amount: amount || null,
        requires_approvals: requirements.requiredApprovals,
        expires_at: new Date(Date.now() + APPROVAL_CONFIG.expirationHours * 60 * 60 * 1000)
      },
      include: {
        maker_employees: {
          select: { email: true, first_name: true, last_name: true }
        }
      }
    });
    
    // 3. Crear steps de aprobación
    for (let i = 0; i < requirements.roles.length; i++) {
      const roleSlug = requirements.roles[i].toLowerCase();
      const role = await prisma.roles.findFirst({
        where: { 
          slug: { contains: roleSlug, mode: 'insensitive' }
        }
      });
      
      if (role) {
        await prisma.approval_steps.create({
          data: {
            approval_request_id: request.id,
            step_order: i + 1,
            approver_role_id: role.id,
            approval_type: 'ANY_ONE',
            status: i === 0 ? 'PENDING' : 'WAITING'
          }
        });
      }
    }
    
    // 4. Log de auditoría
    await auditLogService.log({
      actorType: 'employee',
      actorId: makerId,
      action: 'approval_requested',
      resource: resourceType,
      resourceId,
      description: `Solicitud de aprobación para ${operationType}`,
      newData: { payload, amount, reason }
    });
    
    return request;
  },
  
  // Determinar requisitos basados en tipo y monto
  determineApprovalRequirements(operationType: string, amount?: number): {
    requiredApprovals: number;
    roles: string[];
  } {
    // Operaciones siempre sensibles
    if (APPROVAL_CONFIG.sensitiveOperations.includes(operationType)) {
      const threshold = APPROVAL_CONFIG.thresholds.find(t => 
        !amount || amount <= t.maxAmount
      );
      return {
        requiredApprovals: Math.max(threshold?.requiredApprovals || 1, 1),
        roles: threshold?.roles || ['ADMIN']
      };
    }
    
    // Basado en monto
    if (amount) {
      const threshold = APPROVAL_CONFIG.thresholds.find(t => amount <= t.maxAmount);
      if (threshold) {
        return {
          requiredApprovals: threshold.requiredApprovals,
          roles: threshold.roles
        };
      }
    }
    
    // Default
    return { requiredApprovals: 1, roles: ['ADMIN'] };
  },
  
  // -------------------------------------------
  // PROCESAR DECISIÓN
  // -------------------------------------------
  
  async processDecision(input: ApprovalDecisionInput) {
    const { requestId, checkerId, decision, comments, ipAddress } = input;
    
    return prisma.$transaction(async (tx) => {
      // 1. Obtener request con lock
      const request = await tx.approval_requests.findUnique({
        where: { id: requestId },
        include: {
          maker_employees: true,
          approval_steps: {
            include: { approver_role: true },
            orderBy: { step_order: 'asc' }
          },
          approval_decisions: true
        }
      });
      
      if (!request) throw new Error('Solicitud no encontrada');
      if (request.status !== 'PENDING') throw new Error('Solicitud ya procesada');
      if (request.expires_at < new Date()) throw new Error('Solicitud expirada');
      
      // 2. Verificar que no sea el maker
      if (request.maker_id === checkerId) {
        throw new Error('El creador no puede aprobar su propia solicitud');
      }
      
      // 3. Verificar que no haya decidido antes
      const existingDecision = request.approval_decisions.find(d => d.checker_id === checkerId);
      if (existingDecision) {
        throw new Error('Ya has dado tu decisión en esta solicitud');
      }
      
      // 4. Verificar que el checker tenga permiso
      const checker = await tx.employees.findUnique({
        where: { id: checkerId },
        include: { employee_roles: { include: { role: true } } }
      });
      
      if (!checker) throw new Error('Empleado no encontrado');
      
      const currentStep = request.approval_steps.find(s => s.status === 'PENDING');
      if (!currentStep) throw new Error('No hay step pendiente de aprobación');
      
      const hasRole = checker.employee_roles.some(er => 
        er.role_id === currentStep.approver_role_id
      ) || ['SUPER_ADMIN', 'ADMIN'].includes(checker.role);
      
      if (!hasRole) {
        throw new Error('No tienes el rol requerido para aprobar esta solicitud');
      }
      
      // 5. Registrar decisión
      await tx.approval_decisions.create({
        data: {
          approval_request_id: requestId,
          checker_id: checkerId,
          decision,
          comments,
          ip_address: ipAddress
        }
      });
      
      // 6. Calcular nuevo estado
      let newStatus = request.status;
      
      if (decision === 'REJECT') {
        newStatus = 'REJECTED';
      } else if (decision === 'APPROVE') {
        const totalApprovals = request.approval_decisions.filter(d => 
          d.decision === 'APPROVE'
        ).length + 1;
        
        if (totalApprovals >= request.requires_approvals) {
          newStatus = 'APPROVED';
        } else {
          // Avanzar al siguiente step si existe
          const nextStep = request.approval_steps.find(s => s.status === 'WAITING');
          if (nextStep) {
            await tx.approval_steps.update({
              where: { id: currentStep.id },
              data: { status: 'COMPLETED' }
            });
            await tx.approval_steps.update({
              where: { id: nextStep.id },
              data: { status: 'PENDING' }
            });
          }
        }
      }
      
      // 7. Actualizar request
      const updatedRequest = await tx.approval_requests.update({
        where: { id: requestId },
        data: {
          status: newStatus,
          current_approvals: decision === 'APPROVE' 
            ? { increment: 1 } 
            : undefined
        },
        include: {
          maker_employees: { select: { email: true } },
          approval_decisions: { include: { checker_employees: { select: { email: true } } } }
        }
      });
      
      // 8. Si fue aprobado, ejecutar la operación
      if (newStatus === 'APPROVED') {
        await this.executeApprovedOperation(tx, updatedRequest);
      }
      
      // 9. Log de auditoría
      await auditLogService.log({
        actorType: 'employee',
        actorId: checkerId,
        action: `approval_${decision.toLowerCase()}`,
        resource: 'approval_requests',
        resourceId: requestId,
        description: `${decision} para ${request.operation_type}`,
        metadata: { comments, finalStatus: newStatus }
      });
      
      return updatedRequest;
    });
  },
  
  // Ejecutar operación aprobada
  async executeApprovedOperation(tx: any, request: any) {
    const { resource_type, resource_id, operation_type, payload } = request;
    
    try {
      switch (operation_type) {
        case 'user_block':
          await tx.users.update({
            where: { id: resource_id },
            data: { status: 'BLOCKED' }
          });
          break;
          
        case 'user_unblock':
          await tx.users.update({
            where: { id: resource_id },
            data: { status: 'ACTIVE' }
          });
          break;
          
        case 'limit_increase':
          const account = await tx.accounts.findFirst({
            where: { user_id: resource_id }
          });
          if (account) {
            await tx.accounts.update({
              where: { id: account.id },
              data: {
                daily_limit: payload.dailyLimit || account.daily_limit,
                monthly_limit: payload.monthlyLimit || account.monthly_limit
              }
            });
          }
          break;
          
        case 'investment_liquidate':
          await tx.investments.update({
            where: { id: resource_id },
            data: { 
              status: 'LIQUIDATED',
              liquidated_at: new Date()
            }
          });
          break;
          
        case 'settings_critical':
          if (payload.key && payload.value !== undefined) {
            await tx.system_settings.update({
              where: { key: payload.key },
              data: { value: payload.value.toString() }
            });
          }
          break;
          
        default:
          console.warn(`Operación no implementada: ${operation_type}`);
      }
      
      // Marcar como ejecutada
      await tx.approval_requests.update({
        where: { id: request.id },
        data: {
          status: 'EXECUTED',
          executed_at: new Date()
        }
      });
      
    } catch (error: any) {
      console.error('Error ejecutando operación aprobada:', error);
      throw error;
    }
  },
  
  // -------------------------------------------
  // CONSULTAS
  // -------------------------------------------
  
  async getPendingRequests(filters?: {
    resourceType?: string;
    makerId?: string;
    limit?: number;
  }) {
    return prisma.approval_requests.findMany({
      where: {
        status: 'PENDING',
        expires_at: { gt: new Date() },
        resource_type: filters?.resourceType,
        maker_id: filters?.makerId
      },
      include: {
        maker_employees: {
          select: { id: true, email: true, first_name: true, last_name: true }
        },
        approval_steps: {
          include: { approver_role: true },
          orderBy: { step_order: 'asc' }
        },
        approval_decisions: {
          include: {
            checker_employees: {
              select: { email: true, first_name: true, last_name: true }
            }
          }
        }
      },
      orderBy: { created_at: 'desc' },
      take: filters?.limit || 50
    });
  },
  
  async getRequestById(requestId: string) {
    return prisma.approval_requests.findUnique({
      where: { id: requestId },
      include: {
        maker_employees: {
          select: { id: true, email: true, first_name: true, last_name: true, role: true }
        },
        approval_steps: {
          include: { approver_role: true },
          orderBy: { step_order: 'asc' }
        },
        approval_decisions: {
          include: {
            checker_employees: {
              select: { id: true, email: true, first_name: true, last_name: true }
            }
          },
          orderBy: { decided_at: 'asc' }
        }
      }
    });
  },
  
  async getRequestsForChecker(checkerId: string, limit = 50) {
    // Obtener roles del checker
    const checker = await prisma.employees.findUnique({
      where: { id: checkerId },
      include: { employee_roles: true }
    });
    
    if (!checker) return [];
    
    const roleIds = checker.employee_roles.map(er => er.role_id);
    
    return prisma.approval_requests.findMany({
      where: {
        status: 'PENDING',
        expires_at: { gt: new Date() },
        maker_id: { not: checkerId }, // Excluir propias
        approval_steps: {
          some: {
            status: 'PENDING',
            approver_role_id: { in: roleIds }
          }
        }
      },
      include: {
        maker_employees: {
          select: { email: true, first_name: true, last_name: true }
        },
        approval_steps: {
          include: { approver_role: true }
        },
        _count: { select: { approval_decisions: true } }
      },
      orderBy: { created_at: 'desc' },
      take: limit
    });
  },
  
  async getHistory(filters?: {
    resourceType?: string;
    status?: string;
    makerId?: string;
    checkerId?: string;
    dateFrom?: Date;
    dateTo?: Date;
    page?: number;
    limit?: number;
  }) {
    const { page = 1, limit = 20 } = filters || {};
    const skip = (page - 1) * limit;
    
    const where: any = {};
    
    if (filters?.resourceType) where.resource_type = filters.resourceType;
    if (filters?.status) where.status = filters.status;
    if (filters?.makerId) where.maker_id = filters.makerId;
    if (filters?.checkerId) {
      where.approval_decisions = { some: { checker_id: filters.checkerId } };
    }
    if (filters?.dateFrom || filters?.dateTo) {
      where.created_at = {};
      if (filters.dateFrom) where.created_at.gte = filters.dateFrom;
      if (filters.dateTo) where.created_at.lte = filters.dateTo;
    }
    
    const [requests, total] = await Promise.all([
      prisma.approval_requests.findMany({
        where,
        include: {
          maker_employees: { select: { email: true, first_name: true, last_name: true } },
          approval_decisions: {
            include: { checker_employees: { select: { email: true } } }
          }
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit
      }),
      prisma.approval_requests.count({ where })
    ]);
    
    return {
      requests,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  },
  
  // -------------------------------------------
  // EXPIRACIÓN
  // -------------------------------------------
  
  async expireOldRequests() {
    const result = await prisma.approval_requests.updateMany({
      where: {
        status: 'PENDING',
        expires_at: { lt: new Date() }
      },
      data: { status: 'EXPIRED' }
    });
    
    if (result.count > 0) {
      console.log(`⏰ ${result.count} solicitudes de aprobación expiradas`);
    }
    
    return result.count;
  },
  
  // -------------------------------------------
  // HELPER: Verificar si operación requiere aprobación
  // -------------------------------------------
  
  requiresApproval(operationType: string, amount?: number): boolean {
    if (APPROVAL_CONFIG.sensitiveOperations.includes(operationType)) {
      return true;
    }
    
    if (amount && amount > APPROVAL_CONFIG.thresholds[0].maxAmount) {
      return true;
    }
    
    return false;
  }
};
