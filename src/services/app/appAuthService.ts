import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { 
  generateAccessToken, 
  generateRefreshToken, 
  verifyRefreshToken,
  REFRESH_TOKEN_EXPIRY 
} from '../../middleware/appAuth';
import { walletService } from './walletService';

const prisma = new PrismaClient();
const SALT_ROUNDS = 12;

export const appAuthService = {
  // ============================================
  // REGISTRO
  // ============================================
  async register(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
  }) {
    const { email, password, firstName, lastName, phone } = data;
    
    // Validaciones
    if (!email || !password || !firstName || !lastName) {
      throw new Error('Todos los campos son requeridos');
    }
    
    if (password.length < 8) {
      throw new Error('La contraseña debe tener al menos 8 caracteres');
    }
    
    // Verificar email único
    const existing = await prisma.users.findUnique({
      where: { email: email.toLowerCase() }
    });
    
    if (existing) {
      throw new Error('Este email ya está registrado');
    }
    
    // Verificar teléfono único (si se proporciona)
    if (phone) {
      const existingPhone = await prisma.users.findUnique({
        where: { phone }
      });
      
      if (existingPhone) {
        throw new Error('Este teléfono ya está registrado');
      }
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    
    // Crear usuario
    const user = await prisma.users.create({
      data: {
        email: email.toLowerCase(),
        password_hash: passwordHash,
        first_name: firstName,
        last_name: lastName,
        phone,
        status: 'PENDING_VERIFICATION',
        kyc_status: 'PENDING',
        user_level: 'PLATA',
        points_balance: 0,
        lifetime_points: 0
      }
    });
    
    // Generar tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    
    // Guardar sesión
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);
    
    await prisma.user_sessions.create({
      data: {
        user_id: user.id,
        refresh_token: refreshToken,
        expires_at: expiresAt
      }
    });
    
    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        status: user.status,
        kycStatus: user.kyc_status,
        userLevel: user.user_level
      },
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: 3600  // 1 hora
      }
    };
  },
  
  // ============================================
  // LOGIN
  // ============================================
  async login(data: {
    email: string;
    password: string;
    deviceInfo?: any;
    ipAddress?: string;
  }) {
    const { email, password, deviceInfo, ipAddress } = data;
    
    // Buscar usuario
    const user = await prisma.users.findUnique({
      where: { email: email.toLowerCase() }
    });
    
    if (!user || !user.password_hash) {
      throw new Error('Credenciales inválidas');
    }
    
    // Verificar password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
      throw new Error('Credenciales inválidas');
    }
    
    // Verificar estado
    if (user.status === 'BLOCKED') {
      throw new Error('Tu cuenta ha sido bloqueada. Contacta a soporte.');
    }
    
    if (user.status === 'SUSPENDED') {
      throw new Error('Tu cuenta está suspendida temporalmente.');
    }
    
    // Generar tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    
    // Guardar sesión
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);
    
    await prisma.user_sessions.create({
      data: {
        user_id: user.id,
        refresh_token: refreshToken,
        device_info: deviceInfo,
        ip_address: ipAddress,
        expires_at: expiresAt
      }
    });
    
    // Actualizar último login
    await prisma.users.update({
      where: { id: user.id },
      data: {
        last_login_at: new Date(),
        last_login_ip: ipAddress
      }
    });
    
    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        status: user.status,
        kycStatus: user.kyc_status,
        userLevel: user.user_level,
        pointsBalance: user.points_balance
      },
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: 3600
      }
    };
  },
  
  // ============================================
  // REFRESH TOKEN
  // ============================================
  async refreshTokens(refreshToken: string) {
    // Verificar token
    const payload = verifyRefreshToken(refreshToken);
    
    if (!payload) {
      throw new Error('Token de refresh inválido o expirado');
    }
    
    // Buscar sesión
    const session = await prisma.user_sessions.findUnique({
      where: { refresh_token: refreshToken },
      include: { user: true }
    });
    
    if (!session || session.revoked_at) {
      throw new Error('Sesión inválida o revocada');
    }
    
    if (new Date() > session.expires_at) {
      throw new Error('Sesión expirada');
    }
    
    const user = session.user;
    
    // Verificar estado del usuario
    if (user.status === 'BLOCKED' || user.status === 'SUSPENDED') {
      throw new Error('Cuenta no activa');
    }
    
    // Generar nuevos tokens
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);
    
    // Rotar refresh token
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);
    
    await prisma.$transaction([
      prisma.user_sessions.update({
        where: { id: session.id },
        data: { revoked_at: new Date() }
      }),
      prisma.user_sessions.create({
        data: {
          user_id: user.id,
          refresh_token: newRefreshToken,
          device_info: session.device_info,
          ip_address: session.ip_address,
          expires_at: expiresAt
        }
      })
    ]);
    
    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: 3600
    };
  },
  
  // ============================================
  // LOGOUT
  // ============================================
  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      // Revocar sesión específica
      await prisma.user_sessions.updateMany({
        where: {
          user_id: userId,
          refresh_token: refreshToken
        },
        data: { revoked_at: new Date() }
      });
    } else {
      // Revocar todas las sesiones
      await prisma.user_sessions.updateMany({
        where: { user_id: userId },
        data: { revoked_at: new Date() }
      });
    }
    
    return { success: true };
  },
  
  // ============================================
  // CAMBIAR CONTRASEÑA
  // ============================================
  async changePassword(userId: string, data: {
    currentPassword: string;
    newPassword: string;
  }) {
    const { currentPassword, newPassword } = data;
    
    const user = await prisma.users.findUnique({
      where: { id: userId }
    });
    
    if (!user || !user.password_hash) {
      throw new Error('Usuario no encontrado');
    }
    
    // Verificar contraseña actual
    const validPassword = await bcrypt.compare(currentPassword, user.password_hash);
    
    if (!validPassword) {
      throw new Error('Contraseña actual incorrecta');
    }
    
    // Validar nueva contraseña
    if (newPassword.length < 8) {
      throw new Error('La nueva contraseña debe tener al menos 8 caracteres');
    }
    
    // Actualizar
    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    
    await prisma.users.update({
      where: { id: userId },
      data: { password_hash: newHash }
    });
    
    // Revocar todas las sesiones excepto la actual
    await prisma.user_sessions.updateMany({
      where: { user_id: userId },
      data: { revoked_at: new Date() }
    });
    
    return { success: true };
  },
  
  // ============================================
  // OBTENER PERFIL
  // ============================================
  async getProfile(userId: string) {
    const user = await prisma.users.findUnique({
      where: { id: userId },
      include: {
        account: {
          select: {
            cvu: true,
            alias: true,
            balance: true,
            status: true
          }
        }
      }
    });
    
    if (!user) {
      throw new Error('Usuario no encontrado');
    }
    
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.first_name,
      lastName: user.last_name,
      dni: user.dni,
      birthDate: user.birth_date,
      address: user.address_street ? {
        street: user.address_street,
        number: user.address_number,
        city: user.address_city,
        state: user.address_state,
        zip: user.address_zip
      } : null,
      status: user.status,
      kycStatus: user.kyc_status,
      userLevel: user.user_level,
      pointsBalance: user.points_balance,
      lifetimePoints: user.lifetime_points,
      account: user.account,
      createdAt: user.created_at
    };
  },
  
  // ============================================
  // ACTUALIZAR PERFIL
  // ============================================
  async updateProfile(userId: string, data: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    fcmToken?: string;
    preferences?: any;
  }) {
    const { firstName, lastName, phone, fcmToken, preferences } = data;
    
    // Si se actualiza teléfono, verificar que no exista
    if (phone) {
      const existing = await prisma.users.findFirst({
        where: {
          phone,
          id: { not: userId }
        }
      });
      
      if (existing) {
        throw new Error('Este teléfono ya está en uso');
      }
    }
    
    const user = await prisma.users.update({
      where: { id: userId },
      data: {
        first_name: firstName,
        last_name: lastName,
        phone,
        fcm_token: fcmToken,
        preferences
      }
    });
    
    return {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone
    };
  },
  
  // ============================================
  // OBTENER SESIONES ACTIVAS
  // ============================================
  async getActiveSessions(userId: string) {
    const sessions = await prisma.user_sessions.findMany({
      where: {
        user_id: userId,
        revoked_at: null,
        expires_at: { gt: new Date() }
      },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        device_info: true,
        ip_address: true,
        created_at: true
      }
    });
    
    return sessions;
  },
  
  // ============================================
  // REVOCAR SESIÓN
  // ============================================
  async revokeSession(userId: string, sessionId: string) {
    const session = await prisma.user_sessions.findFirst({
      where: { id: sessionId, user_id: userId }
    });
    
    if (!session) {
      throw new Error('Sesión no encontrada');
    }
    
    await prisma.user_sessions.update({
      where: { id: sessionId },
      data: { revoked_at: new Date() }
    });
    
    return { success: true };
  }
};
