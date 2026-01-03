import { PrismaClient, EmployeeRole, EmployeeStatus } from '@prisma/client';
import { auditLogService } from './auditLogService';

const prisma = new PrismaClient();

// Jerarquía de roles (mayor número = más alto)
const ROLE_HIERARCHY: Record<EmployeeRole, number> = {
  SUPER_ADMIN: 100,
  ADMIN: 80,
  COMPLIANCE: 60,
  CUSTOMER_SERVICE: 40,
  ANALYST: 20
};

// Qué roles puede gestionar cada rol
const CAN_MANAGE: Record<EmployeeRole, EmployeeRole[]> = {
  SUPER_ADMIN: ['ADMIN', 'COMPLIANCE', 'CUSTOMER_SERVICE', 'ANALYST'],
  ADMIN: ['COMPLIANCE', 'CUSTOMER_SERVICE', 'ANALYST'],
  COMPLIANCE: ['CUSTOMER_SERVICE', 'ANALYST'],
  CUSTOMER_SERVICE: [],
  ANALYST: []
};

export const employeeManagementService = {
  // Verificar si puede gestionar otro empleado
  canManage(managerRole: EmployeeRole, targetRole: EmployeeRole): boolean {
    return CAN_MANAGE[managerRole]?.includes(targetRole) || false;
  },

  // Verificar jerarquía
  isHigherRank(role1: EmployeeRole, role2: EmployeeRole): boolean {
    return ROLE_HIERARCHY[role1] > ROLE_HIERARCHY[role2];
  },

  // Bloquear empleado
  async blockEmployee(params: {
    targetEmployeeId: string;
    managerId: string;
    reason: string;
    duration?: number; // minutos, undefined = permanente
  }) {
    const [manager, target] = await Promise.all([
      prisma.employees.findUnique({ where: { id: params.managerId } }),
      prisma.employees.findUnique({ where: { id: params.targetEmployeeId } })
    ]);

    if (!manager || !target) throw new Error('Empleado no encontrado');
    if (manager.id === target.id) throw new Error('No puedes bloquearte a ti mismo');
    if (!this.canManage(manager.role, target.role)) {
      throw new Error(`No tienes permisos para gestionar empleados con rol ${target.role}`);
    }

    const lockedUntil = params.duration 
      ? new Date(Date.now() + params.duration * 60 * 1000)
      : new Date('2099-12-31');

    await prisma.employees.update({
      where: { id: params.targetEmployeeId },
      data: { 
        status: 'SUSPENDED',
        locked_until: lockedUntil
      }
    });

    // Registrar en historial
    await prisma.employee_changes_history.create({
      data: {
        employee_id: params.targetEmployeeId,
        action: 'BLOCKED',
        old_value: target.status,
        new_value: 'SUSPENDED',
        changed_by_id: params.managerId,
        reason: params.reason
      }
    });

    // Invalidar sesiones activas
    await prisma.employee_sessions.updateMany({
      where: { employee_id: params.targetEmployeeId, expires_at: { gt: new Date() } },
      data: { revoked_at: new Date() }
    });

    await auditLogService.log({
      action: 'EMPLOYEE_BLOCKED',
      actorType: 'employee',
      actorId: params.managerId,
      resource: 'employee',
      resourceId: params.targetEmployeeId,
      description: `Empleado bloqueado: ${params.reason}`,
      metadata: { duration: params.duration, targetRole: target.role }
    });

    return { success: true, lockedUntil };
  },

  // Desbloquear empleado
  async unblockEmployee(params: {
    targetEmployeeId: string;
    managerId: string;
    reason: string;
  }) {
    const [manager, target] = await Promise.all([
      prisma.employees.findUnique({ where: { id: params.managerId } }),
      prisma.employees.findUnique({ where: { id: params.targetEmployeeId } })
    ]);

    if (!manager || !target) throw new Error('Empleado no encontrado');
    if (!this.canManage(manager.role, target.role)) {
      throw new Error(`No tienes permisos para gestionar empleados con rol ${target.role}`);
    }

    await prisma.employees.update({
      where: { id: params.targetEmployeeId },
      data: { 
        status: 'ACTIVE',
        locked_until: null,
        failed_login_attempts: 0
      }
    });

    await prisma.employee_changes_history.create({
      data: {
        employee_id: params.targetEmployeeId,
        action: 'UNBLOCKED',
        old_value: target.status,
        new_value: 'ACTIVE',
        changed_by_id: params.managerId,
        reason: params.reason
      }
    });

    await auditLogService.log({
      action: 'EMPLOYEE_UNBLOCKED',
      actorType: 'employee',
      actorId: params.managerId,
      resource: 'employee',
      resourceId: params.targetEmployeeId,
      description: `Empleado desbloqueado: ${params.reason}`
    });

    return { success: true };
  },

  // Eliminar empleado (soft delete)
  async deleteEmployee(params: {
    targetEmployeeId: string;
    managerId: string;
    reason: string;
  }) {
    const [manager, target] = await Promise.all([
      prisma.employees.findUnique({ where: { id: params.managerId } }),
      prisma.employees.findUnique({ where: { id: params.targetEmployeeId } })
    ]);

    if (!manager || !target) throw new Error('Empleado no encontrado');
    if (manager.id === target.id) throw new Error('No puedes eliminarte a ti mismo');
    if (!this.canManage(manager.role, target.role)) {
      throw new Error(`No tienes permisos para gestionar empleados con rol ${target.role}`);
    }

    // Soft delete - no se borra nada
    await prisma.employees.update({
      where: { id: params.targetEmployeeId },
      data: { 
        status: 'INACTIVE',
        is_deleted: true,
        deleted_at: new Date(),
        deleted_by: params.managerId
      }
    });

    await prisma.employee_changes_history.create({
      data: {
        employee_id: params.targetEmployeeId,
        action: 'DELETED',
        old_value: target.status,
        new_value: 'INACTIVE (deleted)',
        changed_by_id: params.managerId,
        reason: params.reason
      }
    });

    // Invalidar sesiones
    await prisma.employee_sessions.updateMany({
      where: { employee_id: params.targetEmployeeId },
      data: { revoked_at: new Date() }
    });

    await auditLogService.log({
      action: 'EMPLOYEE_DELETED',
      actorType: 'employee',
      actorId: params.managerId,
      resource: 'employee',
      resourceId: params.targetEmployeeId,
      description: `Empleado eliminado (soft): ${params.reason}`,
      severity: 'HIGH'
    });

    return { success: true };
  },

  // Cambiar rol de empleado
  async changeRole(params: {
    targetEmployeeId: string;
    managerId: string;
    newRole: EmployeeRole;
    reason: string;
  }) {
    const [manager, target] = await Promise.all([
      prisma.employees.findUnique({ where: { id: params.managerId } }),
      prisma.employees.findUnique({ where: { id: params.targetEmployeeId } })
    ]);

    if (!manager || !target) throw new Error('Empleado no encontrado');
    
    // Solo puede asignar roles que puede gestionar
    if (!this.canManage(manager.role, target.role)) {
      throw new Error(`No tienes permisos para gestionar empleados con rol ${target.role}`);
    }
    if (!this.canManage(manager.role, params.newRole) && manager.role !== 'SUPER_ADMIN') {
      throw new Error(`No tienes permisos para asignar el rol ${params.newRole}`);
    }

    await prisma.employees.update({
      where: { id: params.targetEmployeeId },
      data: { role: params.newRole }
    });

    await prisma.employee_changes_history.create({
      data: {
        employee_id: params.targetEmployeeId,
        action: 'ROLE_CHANGED',
        field_name: 'role',
        old_value: target.role,
        new_value: params.newRole,
        changed_by_id: params.managerId,
        reason: params.reason
      }
    });

    await auditLogService.log({
      action: 'EMPLOYEE_ROLE_CHANGED',
      actorType: 'employee',
      actorId: params.managerId,
      resource: 'employee',
      resourceId: params.targetEmployeeId,
      description: `Rol cambiado de ${target.role} a ${params.newRole}: ${params.reason}`,
      severity: 'MEDIUM'
    });

    return { success: true, oldRole: target.role, newRole: params.newRole };
  },

  // Obtener empleados que puede gestionar
  async getManageableEmployees(managerId: string) {
    const manager = await prisma.employees.findUnique({ where: { id: managerId } });
    if (!manager) return [];

    const manageableRoles = CAN_MANAGE[manager.role] || [];
    if (manageableRoles.length === 0) return [];

    return prisma.employees.findMany({
      where: { 
        role: { in: manageableRoles },
        is_deleted: false
      },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        role: true,
        status: true,
        locked_until: true,
        last_login_at: true,
        created_at: true
      },
      orderBy: { first_name: 'asc' }
    });
  },

  // Obtener historial de cambios de un empleado
  async getEmployeeHistory(employeeId: string, limit: number = 50) {
    return prisma.employee_changes_history.findMany({
      where: { employee_id: employeeId },
      include: {
        changed_by: { select: { first_name: true, last_name: true, email: true } }
      },
      orderBy: { created_at: 'desc' },
      take: limit
    });
  }
};
