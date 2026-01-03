import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { hasPermission, EmployeeRole } from '../utils/permissions';

export interface AuthRequest extends Request {
  employee?: {
    id: string;
    email: string;
    role: EmployeeRole;
  };
}

export const authMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'No autorizado - Token no proporcionado'
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const decoded = verifyAccessToken(token);

    if (!decoded) {
      return res.status(401).json({
        success: false,
        error: 'No autorizado - Token inválido o expirado'
      });
    }

    req.employee = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role as EmployeeRole
    };

    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Error en autenticación'
    });
  }
};

// Middleware para verificar permisos específicos
export const requirePermission = (permission: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const employee = req.employee;

    if (!employee) {
      return res.status(401).json({
        success: false,
        error: 'No autorizado'
      });
    }

    if (!hasPermission(employee.role, permission)) {
      return res.status(403).json({
        success: false,
        error: 'Permiso denegado',
        required: permission,
        role: employee.role
      });
    }

    next();
  };
};

// Middleware para verificar rol mínimo
export const requireRole = (allowedRoles: EmployeeRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const employee = req.employee;

    if (!employee) {
      return res.status(401).json({
        success: false,
        error: 'No autorizado'
      });
    }

    if (!allowedRoles.includes(employee.role)) {
      return res.status(403).json({
        success: false,
        error: 'Rol insuficiente',
        required: allowedRoles,
        current: employee.role
      });
    }

    next();
  };
};
