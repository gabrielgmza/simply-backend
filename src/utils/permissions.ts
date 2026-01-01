export const PERMISSIONS = {
  SUPER_ADMIN: [
    'employees:*',
    'users:*',
    'leads:*',
    'tickets:*',
    'settings:*',
    'aria:use',
    'dashboard:view'
  ],
  
  ADMIN: [
    'employees:read',
    'users:*',
    'leads:*',
    'tickets:*',
    'aria:use',
    'dashboard:view'
  ],
  
  COMPLIANCE: [
    'users:read',
    'users:update:kyc',
    'leads:read',
    'tickets:read',
    'tickets:create',
    'aria:use',
    'dashboard:view'
  ],
  
  CUSTOMER_SERVICE: [
    'users:read',
    'leads:read',
    'tickets:*',
    'aria:use',
    'dashboard:view'
  ],
  
  ANALYST: [
    'users:read',
    'leads:read',
    'leads:export',
    'tickets:read',
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
