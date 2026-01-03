import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const JWT_SECRET = process.env.JWT_SECRET || 'simply-app-secret-2024';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'simply-refresh-secret-2024';

// Duración de tokens
export const ACCESS_TOKEN_EXPIRY = '1h';      // 1 hora
export const REFRESH_TOKEN_EXPIRY = '90d';    // 90 días

export interface UserPayload {
  userId: string;
  email: string;
  userLevel: string;
  kycStatus: string;
  type: 'access' | 'refresh';
}

export interface AppAuthRequest extends Request {
  user?: UserPayload;
}

// ============================================
// GENERAR TOKENS
// ============================================
export function generateAccessToken(user: {
  id: string;
  email: string;
  user_level: string;
  kyc_status: string;
}): string {
  const payload: UserPayload = {
    userId: user.id,
    email: user.email,
    userLevel: user.user_level,
    kycStatus: user.kyc_status,
    type: 'access'
  };
  
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

export function generateRefreshToken(user: {
  id: string;
  email: string;
  user_level: string;
  kyc_status: string;
}): string {
  const payload: UserPayload = {
    userId: user.id,
    email: user.email,
    userLevel: user.user_level,
    kycStatus: user.kyc_status,
    type: 'refresh'
  };
  
  return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
}

// ============================================
// VERIFICAR TOKENS
// ============================================
export function verifyAccessToken(token: string): UserPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as UserPayload;
    if (decoded.type !== 'access') return null;
    return decoded;
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): UserPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_REFRESH_SECRET) as UserPayload;
    if (decoded.type !== 'refresh') return null;
    return decoded;
  } catch {
    return null;
  }
}

// ============================================
// MIDDLEWARE DE AUTENTICACIÓN
// ============================================
export async function appAuthMiddleware(
  req: AppAuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Token de acceso requerido',
        code: 'MISSING_TOKEN'
      });
    }
    
    const token = authHeader.substring(7);
    const payload = verifyAccessToken(token);
    
    if (!payload) {
      return res.status(401).json({
        success: false,
        error: 'Token inválido o expirado',
        code: 'INVALID_TOKEN'
      });
    }
    
    // Verificar que el usuario existe y está activo
    const user = await prisma.users.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        status: true,
        user_level: true,
        kyc_status: true
      }
    });
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Usuario no encontrado',
        code: 'USER_NOT_FOUND'
      });
    }
    
    if (user.status !== 'ACTIVE' && user.status !== 'PENDING_VERIFICATION') {
      return res.status(403).json({
        success: false,
        error: 'Cuenta suspendida o bloqueada',
        code: 'ACCOUNT_INACTIVE'
      });
    }
    
    req.user = {
      userId: user.id,
      email: user.email,
      userLevel: user.user_level,
      kycStatus: user.kyc_status,
      type: 'access'
    };
    
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      error: 'Error de autenticación',
      code: 'AUTH_ERROR'
    });
  }
}

// ============================================
// MIDDLEWARE KYC REQUERIDO
// ============================================
export function requireKYC(
  req: AppAuthRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'No autenticado',
      code: 'NOT_AUTHENTICATED'
    });
  }
  
  if (req.user.kycStatus !== 'APPROVED') {
    return res.status(403).json({
      success: false,
      error: 'Verificación de identidad requerida',
      code: 'KYC_REQUIRED',
      kycStatus: req.user.kycStatus
    });
  }
  
  next();
}

// ============================================
// RATE LIMITING SIMPLE
// ============================================
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(maxRequests: number, windowMs: number) {
  return (req: AppAuthRequest, res: Response, next: NextFunction) => {
    const key = req.user?.userId || req.ip || 'anonymous';
    const now = Date.now();
    
    const record = rateLimitStore.get(key);
    
    if (!record || now > record.resetAt) {
      rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    
    if (record.count >= maxRequests) {
      return res.status(429).json({
        success: false,
        error: 'Demasiadas solicitudes. Intenta de nuevo más tarde.',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil((record.resetAt - now) / 1000)
      });
    }
    
    record.count++;
    next();
  };
}

// Limpiar rate limit store cada 5 minutos
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);
