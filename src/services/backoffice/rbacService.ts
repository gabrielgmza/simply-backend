import { PrismaClient } from '@prisma/client';
import { auditLogService } from './auditLogService';

const prisma = new PrismaClient();

// ============================================
// TIPOS
// ============================================

interface AccessContext {
  employeeId: string;
  ipAddress?: string;
  timestamp: Date;
  amount?: number;
  resourceId?: string;
}

interface PermissionConditions {
  time_range?: { start: string; end: string };
  ip_whitelist?: string[];
  ip_blacklist?: string[];
  max_amount?: number;
  weekdays_only?: boolean;
  require_mfa?: boolean;
}

interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  conditions_failed?: string[];
  requires_approval?: boolean;
}

// ============================================
// RBAC SERVICE
// ============================================

export const rbacService = {
  // -------------------------------------------
  // VERIFICACIÓN DE PERMISOS
  // -------------------------------------------
  
  async checkPermission(
    employeeId: string,
    resource: string,
    action: string,
    context?: Partial<AccessContext>
  ): Promise<PermissionCheckResult> {
    const fullContext: AccessContext = {
      employeeId,
      timestamp: new Date(),
      ...context
    };

    // 1. Obtener todos los roles del empleado
    const employeeRoles = await prisma.employee_roles.findMany({
      where: {
        employee_id: employeeId,
        is_active: true,
        OR: [
          { expires_at: null },
          { expires_at: { gt: new Date() } }
        ]
      },
      include: {
        role: {
          include: {
            role_permissions: {
              include: {
                permission: true
              }
            },
            parent_role: {
              include: {
                role_permissions: {
                  include: {
                    permission: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (employeeRoles.length === 0) {
      // Fallback al rol legacy del modelo employees
      return this.checkLegacyPermission(employeeId, resource, action);
    }

    // 2. Recopilar todos los permisos (incluyendo heredados)
    const allPermissions: Array<{
      permission: any;
      effect: string;
      conditions: PermissionConditions | null;
      priority: number;
    }> = [];

    for (const er of employeeRoles) {
      // Permisos directos del rol
      for (const rp of er.role.role_permissions) {
        allPermissions.push({
          permission: rp.permission,
          effect: rp.effect,
          conditions: rp.conditions as PermissionConditions | null,
          priority: rp.priority + er.role.priority * 100
        });
      }

      // Permisos heredados del rol padre
      if (er.role.parent_role) {
        for (const rp of er.role.parent_role.role_permissions) {
          allPermissions.push({
            permission: rp.permission,
            effect: rp.effect,
            conditions: rp.conditions as PermissionConditions | null,
            priority: rp.priority + (er.role.parent_role.priority - 1) * 100
          });
        }
      }
    }

    // 3. Filtrar permisos relevantes
    const permissionSlug = `${resource}:${action}`;
    const wildcardSlug = `${resource}:*`;
    
    const relevantPermissions = allPermissions.filter(p => 
      p.permission.slug === permissionSlug || 
      p.permission.slug === wildcardSlug ||
      p.permission.slug === '*:*'
    );

    if (relevantPermissions.length === 0) {
      return { allowed: false, reason: 'No permission found' };
    }

    // 4. Ordenar por prioridad (mayor primero) y evaluar
    relevantPermissions.sort((a, b) => b.priority - a.priority);

    // 5. Evaluar deny primero (deny siempre gana)
    const denyPermission = relevantPermissions.find(p => p.effect === 'deny');
    if (denyPermission) {
      return { allowed: false, reason: 'Explicitly denied' };
    }

    // 6. Evaluar allow con condiciones ABAC
    const allowPermission = relevantPermissions.find(p => p.effect === 'allow');
    if (!allowPermission) {
      return { allowed: false, reason: 'No allow permission found' };
    }

    // 7. Verificar condiciones ABAC
    if (allowPermission.conditions) {
      const conditionResult = this.evaluateConditions(
        allowPermission.conditions,
        fullContext
      );
      if (!conditionResult.passed) {
        return {
          allowed: false,
          reason: 'Conditions not met',
          conditions_failed: conditionResult.failed
        };
      }
    }

    // 8. Verificar si requiere aprobación (operaciones sensibles)
    const requiresApproval = allowPermission.permission.is_sensitive && 
      (fullContext.amount && fullContext.amount > 10000);

    return {
      allowed: true,
      requires_approval: requiresApproval
    };
  },

  // Evaluar condiciones ABAC
  evaluateConditions(
    conditions: PermissionConditions,
    context: AccessContext
  ): { passed: boolean; failed: string[] } {
    const failed: string[] = [];

    // Time range check
    if (conditions.time_range) {
      const now = context.timestamp;
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      
      if (currentTime < conditions.time_range.start || currentTime > conditions.time_range.end) {
        failed.push(`Outside allowed time range: ${conditions.time_range.start}-${conditions.time_range.end}`);
      }
    }

    // Weekdays only
    if (conditions.weekdays_only) {
      const day = context.timestamp.getDay();
      if (day === 0 || day === 6) {
        failed.push('Operation not allowed on weekends');
      }
    }

    // IP whitelist
    if (conditions.ip_whitelist && conditions.ip_whitelist.length > 0 && context.ipAddress) {
      if (!conditions.ip_whitelist.includes(context.ipAddress)) {
        failed.push(`IP ${context.ipAddress} not in whitelist`);
      }
    }

    // IP blacklist
    if (conditions.ip_blacklist && conditions.ip_blacklist.length > 0 && context.ipAddress) {
      if (conditions.ip_blacklist.includes(context.ipAddress)) {
        failed.push(`IP ${context.ipAddress} is blacklisted`);
      }
    }

    // Max amount
    if (conditions.max_amount && context.amount) {
      if (context.amount > conditions.max_amount) {
        failed.push(`Amount ${context.amount} exceeds limit ${conditions.max_amount}`);
      }
    }

    return {
      passed: failed.length === 0,
      failed
    };
  },

  // Fallback para sistema legacy
  async checkLegacyPermission(
    employeeId: string,
    resource: string,
    action: string
  ): Promise<PermissionCheckResult> {
    const employee = await prisma.employees.findUnique({
      where: { id: employeeId },
      select: { role: true }
    });

    if (!employee) {
      return { allowed: false, reason: 'Employee not found' };
    }

    // Importar permisos legacy
    const { hasPermission } = await import('../../utils/permissions');
    const permission = `${resource}:${action}`;
    
    const allowed = hasPermission(employee.role, permission);
    
    return {
      allowed,
      reason: allowed ? undefined : 'Legacy permission denied'
    };
  },

  // -------------------------------------------
  // GESTIÓN DE ROLES
  // -------------------------------------------

  async createRole(data: {
    slug: string;
    name: string;
    description?: string;
    parentRoleId?: string;
    priority?: number;
  }) {
    return prisma.roles.create({
      data: {
        slug: data.slug,
        name: data.name,
        description: data.description,
        parent_role_id: data.parentRoleId,
        priority: data.priority || 0
      }
    });
  },

  async getRoles() {
    return prisma.roles.findMany({
      include: {
        parent_role: true,
        _count: {
          select: {
            employee_roles: true,
            role_permissions: true
          }
        }
      },
      orderBy: { priority: 'desc' }
    });
  },

  async getRoleById(roleId: string) {
    return prisma.roles.findUnique({
      where: { id: roleId },
      include: {
        parent_role: true,
        child_roles: true,
        role_permissions: {
          include: {
            permission: true
          }
        },
        employee_roles: {
          include: {
            employees: {
              select: {
                id: true,
                email: true,
                first_name: true,
                last_name: true
              }
            }
          }
        }
      }
    });
  },

  // -------------------------------------------
  // GESTIÓN DE PERMISOS
  // -------------------------------------------

  async createPermission(data: {
    slug: string;
    resource: string;
    action: string;
    description?: string;
    isSensitive?: boolean;
  }) {
    return prisma.permissions.create({
      data: {
        slug: data.slug,
        resource: data.resource,
        action: data.action,
        description: data.description,
        is_sensitive: data.isSensitive || false
      }
    });
  },

  async getPermissions(filters?: { resource?: string; action?: string }) {
    return prisma.permissions.findMany({
      where: {
        resource: filters?.resource,
        action: filters?.action
      },
      orderBy: [
        { resource: 'asc' },
        { action: 'asc' }
      ]
    });
  },

  async assignPermissionToRole(
    roleId: string,
    permissionId: string,
    options?: {
      effect?: 'allow' | 'deny';
      conditions?: PermissionConditions;
      grantedBy?: string;
      expiresAt?: Date;
    }
  ) {
    const result = await prisma.role_permissions.create({
      data: {
        role_id: roleId,
        permission_id: permissionId,
        effect: options?.effect || 'allow',
        conditions: options?.conditions || null,
        granted_by: options?.grantedBy,
        expires_at: options?.expiresAt
      },
      include: {
        permission: true,
        role: true
      }
    });

    // Audit log
    if (options?.grantedBy) {
      await auditLogService.log({
        actorType: 'employee',
        actorId: options.grantedBy,
        action: 'permission_granted',
        resource: 'role_permissions',
        resourceId: result.id,
        description: `Permission ${result.permission.slug} granted to role ${result.role.name}`,
        newData: {
          roleId,
          permissionId,
          effect: options?.effect,
          conditions: options?.conditions
        }
      });
    }

    return result;
  },

  async revokePermissionFromRole(
    roleId: string,
    permissionId: string,
    revokedBy?: string,
    reason?: string
  ) {
    const existing = await prisma.role_permissions.findUnique({
      where: {
        role_id_permission_id: {
          role_id: roleId,
          permission_id: permissionId
        }
      },
      include: {
        permission: true,
        role: true
      }
    });

    if (!existing) {
      throw new Error('Permission assignment not found');
    }

    await prisma.role_permissions.delete({
      where: {
        role_id_permission_id: {
          role_id: roleId,
          permission_id: permissionId
        }
      }
    });

    // Audit log
    if (revokedBy) {
      await auditLogService.log({
        actorType: 'employee',
        actorId: revokedBy,
        action: 'permission_revoked',
        resource: 'role_permissions',
        description: `Permission ${existing.permission.slug} revoked from role ${existing.role.name}`,
        oldData: {
          roleId,
          permissionId,
          effect: existing.effect,
          conditions: existing.conditions
        },
        metadata: { reason }
      });
    }
  },

  // -------------------------------------------
  // ASIGNACIÓN DE ROLES A EMPLEADOS
  // -------------------------------------------

  async assignRoleToEmployee(
    employeeId: string,
    roleId: string,
    options?: {
      grantedBy?: string;
      expiresAt?: Date;
    }
  ) {
    const result = await prisma.employee_roles.create({
      data: {
        employee_id: employeeId,
        role_id: roleId,
        granted_by: options?.grantedBy,
        expires_at: options?.expiresAt
      },
      include: {
        employees: { select: { email: true, first_name: true, last_name: true } },
        role: true
      }
    });

    // Audit log
    if (options?.grantedBy) {
      await auditLogService.log({
        actorType: 'employee',
        actorId: options.grantedBy,
        action: 'role_assigned',
        resource: 'employees',
        resourceId: employeeId,
        description: `Role ${result.role.name} assigned to ${result.employees.email}`,
        newData: { roleId, expiresAt: options?.expiresAt }
      });
    }

    return result;
  },

  async revokeRoleFromEmployee(
    employeeId: string,
    roleId: string,
    revokedBy?: string,
    reason?: string
  ) {
    const existing = await prisma.employee_roles.findUnique({
      where: {
        employee_id_role_id: {
          employee_id: employeeId,
          role_id: roleId
        }
      },
      include: {
        employees: { select: { email: true } },
        role: true
      }
    });

    if (!existing) {
      throw new Error('Role assignment not found');
    }

    await prisma.employee_roles.update({
      where: {
        employee_id_role_id: {
          employee_id: employeeId,
          role_id: roleId
        }
      },
      data: { is_active: false }
    });

    // Audit log
    if (revokedBy) {
      await auditLogService.log({
        actorType: 'employee',
        actorId: revokedBy,
        action: 'role_revoked',
        resource: 'employees',
        resourceId: employeeId,
        description: `Role ${existing.role.name} revoked from ${existing.employees.email}`,
        metadata: { reason }
      });
    }
  },

  async getEmployeeRoles(employeeId: string) {
    return prisma.employee_roles.findMany({
      where: {
        employee_id: employeeId,
        is_active: true
      },
      include: {
        role: {
          include: {
            role_permissions: {
              include: {
                permission: true
              }
            }
          }
        }
      }
    });
  },

  async getEmployeeEffectivePermissions(employeeId: string) {
    const roles = await this.getEmployeeRoles(employeeId);
    
    const permissions = new Map<string, {
      permission: any;
      effect: string;
      conditions: any;
      fromRole: string;
    }>();

    for (const er of roles) {
      for (const rp of er.role.role_permissions) {
        const key = rp.permission.slug;
        // El permiso con mayor prioridad gana
        if (!permissions.has(key)) {
          permissions.set(key, {
            permission: rp.permission,
            effect: rp.effect,
            conditions: rp.conditions,
            fromRole: er.role.name
          });
        }
      }
    }

    return Array.from(permissions.values());
  },

  // -------------------------------------------
  // INICIALIZACIÓN DE PERMISOS BASE
  // -------------------------------------------

  async initializeDefaultPermissions() {
    const resources = [
      'users', 'employees', 'investments', 'financings', 'tickets',
      'settings', 'audit', 'treasury', 'otc', 'fraud', 'compliance',
      'dashboard', 'aria', 'reports', 'providers'
    ];

    const actions = ['view', 'create', 'update', 'delete', 'authorize', 'audit', 'export'];

    const sensitiveOperations = [
      'users:delete', 'users:block',
      'investments:liquidate', 'investments:authorize',
      'financings:liquidate', 'financings:authorize',
      'settings:update',
      'treasury:withdraw', 'treasury:authorize',
      'otc:authorize',
      'employees:delete'
    ];

    for (const resource of resources) {
      for (const action of actions) {
        const slug = `${resource}:${action}`;
        const isSensitive = sensitiveOperations.includes(slug);

        await prisma.permissions.upsert({
          where: { slug },
          update: { is_sensitive: isSensitive },
          create: {
            slug,
            resource,
            action,
            is_sensitive: isSensitive,
            description: `${action.charAt(0).toUpperCase() + action.slice(1)} ${resource}`
          }
        });
      }
    }

    console.log('✅ Default permissions initialized');
  },

  async initializeDefaultRoles() {
    const roles = [
      { slug: 'super_admin', name: 'Super Administrador', priority: 100, isSystem: true },
      { slug: 'admin', name: 'Administrador', priority: 80, parentSlug: 'super_admin' },
      { slug: 'compliance', name: 'Compliance Officer', priority: 60 },
      { slug: 'customer_service', name: 'Atención al Cliente', priority: 40 },
      { slug: 'analyst', name: 'Analista', priority: 20 },
      { slug: 'viewer', name: 'Solo Lectura', priority: 10 }
    ];

    for (const role of roles) {
      let parentId: string | undefined;
      
      if (role.parentSlug) {
        const parent = await prisma.roles.findUnique({
          where: { slug: role.parentSlug }
        });
        parentId = parent?.id;
      }

      await prisma.roles.upsert({
        where: { slug: role.slug },
        update: {
          name: role.name,
          priority: role.priority,
          parent_role_id: parentId
        },
        create: {
          slug: role.slug,
          name: role.name,
          priority: role.priority,
          is_system: role.isSystem || false,
          parent_role_id: parentId
        }
      });
    }

    console.log('✅ Default roles initialized');
  }
};
