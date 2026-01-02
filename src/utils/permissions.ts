export const PERMISSIONS = {
  SUPER_ADMIN: [
    'employees:*',
    'users:*',
    'leads:*',
    'tickets:*',
    'settings:*',
    'investments:*',
    'financings:*',
    'audit:*',
    'aria:use',
    'dashboard:view'
  ],
  
  ADMIN: [
    'employees:read',
    'users:*',
    'leads:*',
    'tickets:*',
    'settings:read',
    'investments:read',
    'investments:create',
    'financings:read',
    'financings:pay',
    'audit:read',
    'aria:use',
    'dashboard:view'
  ],
  
  COMPLIANCE: [
    'users:read',
    'users:update',
    'users:block',
    'users:risk',
    'leads:read',
    'tickets:read',
    'tickets:create',
    'settings:read',
    'investments:read',
    'financings:read',
    'audit:read',
    'aria:use',
    'dashboard:view'
  ],
  
  CUSTOMER_SERVICE: [
    'users:read',
    'leads:read',
    'tickets:*',
    'investments:read',
    'financings:read',
    'financings:pay',
    'aria:use',
    'dashboard:view'
  ],
  
  ANALYST: [
    'users:read',
    'leads:read',
    'leads:export',
    'tickets:read',
    'settings:read',
    'investments:read',
    'financings:read',
    'audit:read',
    'aria:use',
    'dashboard:view'
  ]
} as const;

export type EmployeeRole = keyof typeof PERMISSIONS;

export const hasPermission = (role: EmployeeRole, permission: string): boolean => {
  const rolePermissions = PERMISSIONS[role];
  
  if (!rolePermissions) return false;
  
  return rolePermissions.some(p => {
    // Wildcard support: employees:* permite employees:read, employees:create, etc
    if (p.endsWith(':*')) {
      const prefix = p.replace(':*', '');
      return permission.startsWith(prefix);
    }
    return p === permission;
  });
};

export const getRolePermissions = (role: EmployeeRole): readonly string[] => {
  return PERMISSIONS[role] || [];
};
