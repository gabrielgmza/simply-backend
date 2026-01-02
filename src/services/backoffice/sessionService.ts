import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const prisma = new PrismaClient();

// ============================================
// CONFIGURACIÓN PCI DSS 4.0 COMPLIANT
// ============================================

const SESSION_CONFIG = {
  // Tokens
  accessTokenExpiry: 15 * 60,         // 15 minutos (PCI DSS 4.0)
  refreshTokenExpiry: 7 * 24 * 60 * 60, // 7 días
  
  // Sesiones
  idleTimeout: 15 * 60 * 1000,        // 15 min de inactividad (PCI DSS 8.2.8)
  absoluteTimeout: 8 * 60 * 60 * 1000, // 8 horas máximo
  maxConcurrentSessions: 5,
  
  // Contraseñas
  passwordMinLength: 12,
  passwordRequireUppercase: true,
  passwordRequireLowercase: true,
  passwordRequireNumber: true,
  passwordRequireSpecial: true,
  passwordExpiryDays: 90,             // PCI DSS: 90 días máximo
  passwordHistoryCount: 12,           // No repetir últimas 12
  
  // Lockout
  maxFailedAttempts: 5,
  lockoutDurationMinutes: 30,
  
  // Secretos
  accessTokenSecret: process.env.JWT_ACCESS_SECRET || 'simply-access-secret-change-in-production',
  refreshTokenSecret: process.env.JWT_REFRESH_SECRET || 'simply-refresh-secret-change-in-production'
};

// ============================================
// TIPOS
// ============================================

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface SessionInfo {
  id: string;
  deviceInfo: any;
  ipAddress: string | null;
  createdAt: Date;
  lastActivity: Date;
  isCurrent: boolean;
}

// ============================================
// SESSION SERVICE
// ============================================

export const sessionService = {
  // -------------------------------------------
  // AUTENTICACIÓN
  // -------------------------------------------
  
  async login(
    email: string,
    password: string,
    deviceInfo?: any,
    ipAddress?: string
  ): Promise<{
    tokens: TokenPair;
    employee: any;
    requiresPasswordChange: boolean;
  }> {
    // 1. Buscar empleado
    const employee = await prisma.employees.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        role: true,
        status: true,
        password_hash: true,
        password_changed_at: true,
        password_expires_at: true,
        force_password_change: true,
        failed_login_attempts: true,
        locked_until: true
      }
    });
    
    if (!employee) {
      throw new Error('Credenciales inválidas');
    }
    
    // 2. Verificar lockout
    if (employee.locked_until && employee.locked_until > new Date()) {
      const remainingMinutes = Math.ceil(
        (employee.locked_until.getTime() - Date.now()) / 60000
      );
      throw new Error(`Cuenta bloqueada. Intenta en ${remainingMinutes} minutos`);
    }
    
    // 3. Verificar estado
    if (employee.status !== 'ACTIVE') {
      throw new Error('Cuenta suspendida o inactiva');
    }
    
    // 4. Verificar contraseña
    const validPassword = await bcrypt.compare(password, employee.password_hash);
    
    if (!validPassword) {
      // Incrementar intentos fallidos
      const newAttempts = employee.failed_login_attempts + 1;
      const updates: any = { failed_login_attempts: newAttempts };
      
      if (newAttempts >= SESSION_CONFIG.maxFailedAttempts) {
        updates.locked_until = new Date(
          Date.now() + SESSION_CONFIG.lockoutDurationMinutes * 60 * 1000
        );
      }
      
      await prisma.employees.update({
        where: { id: employee.id },
        data: updates
      });
      
      throw new Error('Credenciales inválidas');
    }
    
    // 5. Reset intentos fallidos
    await prisma.employees.update({
      where: { id: employee.id },
      data: {
        failed_login_attempts: 0,
        locked_until: null,
        last_login_at: new Date(),
        last_login_ip: ipAddress,
        last_activity_at: new Date()
      }
    });
    
    // 6. Verificar límite de sesiones
    await this.enforceSessionLimit(employee.id);
    
    // 7. Crear sesión
    const tokenFamily = crypto.randomUUID();
    const tokens = await this.createTokenPair(employee, tokenFamily);
    
    await prisma.employee_sessions.create({
      data: {
        employee_id: employee.id,
        refresh_token: this.hashToken(tokens.refreshToken),
        token_family: tokenFamily,
        device_info: deviceInfo || {},
        ip_address: ipAddress,
        expires_at: new Date(Date.now() + SESSION_CONFIG.refreshTokenExpiry * 1000)
      }
    });
    
    // 8. Determinar si necesita cambiar contraseña
    const requiresPasswordChange = 
      employee.force_password_change === true ||
      !employee.password_changed_at ||
      (employee.password_expires_at ? employee.password_expires_at < new Date() : false);
    
    return {
      tokens,
      employee: {
        id: employee.id,
        email: employee.email,
        first_name: employee.first_name,
        last_name: employee.last_name,
        role: employee.role
      },
      requiresPasswordChange: requiresPasswordChange === true
    };
  },
  
  // -------------------------------------------
  // TOKENS
  // -------------------------------------------
  
  async createTokenPair(employee: any, tokenFamily: string): Promise<TokenPair> {
    const payload = {
      id: employee.id,
      email: employee.email,
      role: employee.role
    };
    
    const accessToken = jwt.sign(
      { ...payload, type: 'access', jti: crypto.randomUUID() },
      SESSION_CONFIG.accessTokenSecret,
      { expiresIn: SESSION_CONFIG.accessTokenExpiry }
    );
    
    const refreshToken = jwt.sign(
      { ...payload, type: 'refresh', jti: crypto.randomUUID(), family: tokenFamily },
      SESSION_CONFIG.refreshTokenSecret,
      { expiresIn: SESSION_CONFIG.refreshTokenExpiry }
    );
    
    return {
      accessToken,
      refreshToken,
      expiresIn: SESSION_CONFIG.accessTokenExpiry
    };
  },
  
  async refreshTokens(currentRefreshToken: string): Promise<TokenPair> {
    // 1. Verificar y decodificar token
    let decoded: any;
    try {
      decoded = jwt.verify(currentRefreshToken, SESSION_CONFIG.refreshTokenSecret);
    } catch (error) {
      throw new Error('Token inválido o expirado');
    }
    
    if (decoded.type !== 'refresh') {
      throw new Error('Token inválido');
    }
    
    // 2. Buscar sesión
    const tokenHash = this.hashToken(currentRefreshToken);
    const session = await prisma.employee_sessions.findFirst({
      where: {
        refresh_token: tokenHash,
        is_active: true
      }
    });
    
    if (!session) {
      // Posible token reuse attack - revocar toda la familia
      await this.revokeTokenFamily(decoded.family, 'Token reuse detected');
      throw new Error('Sesión inválida - todas las sesiones revocadas por seguridad');
    }
    
    // 3. Verificar expiración
    if (session.expires_at < new Date()) {
      await this.revokeSession(session.id, 'Token expired');
      throw new Error('Sesión expirada');
    }
    
    // 4. Obtener empleado
    const employee = await prisma.employees.findUnique({
      where: { id: session.employee_id },
      select: { id: true, email: true, role: true, status: true }
    });
    
    if (!employee || employee.status !== 'ACTIVE') {
      await this.revokeSession(session.id, 'Employee inactive');
      throw new Error('Cuenta inactiva');
    }
    
    // 5. Rotar refresh token (invalidar el anterior)
    const newTokens = await this.createTokenPair(employee, session.token_family);
    
    await prisma.employee_sessions.update({
      where: { id: session.id },
      data: {
        refresh_token: this.hashToken(newTokens.refreshToken),
        last_activity: new Date()
      }
    });
    
    return newTokens;
  },
  
  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  },
  
  // -------------------------------------------
  // SESIONES
  // -------------------------------------------
  
  async validateSession(sessionId: string, employeeId: string): Promise<{
    valid: boolean;
    reason?: string;
    expiresIn?: number;
  }> {
    const session = await prisma.employee_sessions.findFirst({
      where: {
        id: sessionId,
        employee_id: employeeId,
        is_active: true
      }
    });
    
    if (!session) {
      return { valid: false, reason: 'Session not found' };
    }
    
    // Check idle timeout
    const idleTime = Date.now() - session.last_activity.getTime();
    if (idleTime > SESSION_CONFIG.idleTimeout) {
      await this.revokeSession(session.id, 'Idle timeout');
      return { valid: false, reason: 'Idle timeout' };
    }
    
    // Check absolute timeout
    const sessionAge = Date.now() - session.created_at.getTime();
    if (sessionAge > SESSION_CONFIG.absoluteTimeout) {
      await this.revokeSession(session.id, 'Absolute timeout');
      return { valid: false, reason: 'Absolute timeout' };
    }
    
    // Update last activity (sliding window)
    await prisma.employee_sessions.update({
      where: { id: session.id },
      data: { last_activity: new Date() }
    });
    
    return {
      valid: true,
      expiresIn: SESSION_CONFIG.idleTimeout - idleTime
    };
  },
  
  async revokeSession(sessionId: string, reason?: string) {
    await prisma.employee_sessions.update({
      where: { id: sessionId },
      data: {
        is_active: false,
        revoked_at: new Date(),
        revoke_reason: reason
      }
    });
  },
  
  async revokeAllSessions(employeeId: string, exceptSessionId?: string) {
    await prisma.employee_sessions.updateMany({
      where: {
        employee_id: employeeId,
        is_active: true,
        id: exceptSessionId ? { not: exceptSessionId } : undefined
      },
      data: {
        is_active: false,
        revoked_at: new Date(),
        revoke_reason: 'Revoked by user'
      }
    });
  },
  
  async revokeTokenFamily(tokenFamily: string, reason: string) {
    await prisma.employee_sessions.updateMany({
      where: {
        token_family: tokenFamily,
        is_active: true
      },
      data: {
        is_active: false,
        revoked_at: new Date(),
        revoke_reason: reason
      }
    });
  },
  
  async enforceSessionLimit(employeeId: string) {
    const activeSessions = await prisma.employee_sessions.findMany({
      where: {
        employee_id: employeeId,
        is_active: true
      },
      orderBy: { last_activity: 'asc' }
    });
    
    // Revocar las más antiguas si excede el límite
    const toRevoke = activeSessions.length - SESSION_CONFIG.maxConcurrentSessions + 1;
    if (toRevoke > 0) {
      const sessionsToRevoke = activeSessions.slice(0, toRevoke);
      for (const session of sessionsToRevoke) {
        await this.revokeSession(session.id, 'Session limit exceeded');
      }
    }
  },
  
  async getEmployeeSessions(employeeId: string): Promise<SessionInfo[]> {
    const sessions = await prisma.employee_sessions.findMany({
      where: {
        employee_id: employeeId,
        is_active: true
      },
      orderBy: { last_activity: 'desc' }
    });
    
    return sessions.map(s => ({
      id: s.id,
      deviceInfo: s.device_info,
      ipAddress: s.ip_address,
      createdAt: s.created_at,
      lastActivity: s.last_activity,
      isCurrent: false // Se marca en el controller
    }));
  },
  
  // -------------------------------------------
  // CONTRASEÑAS
  // -------------------------------------------
  
  async changePassword(
    employeeId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    const employee = await prisma.employees.findUnique({
      where: { id: employeeId },
      select: { password_hash: true }
    });
    
    if (!employee) throw new Error('Empleado no encontrado');
    
    // Verificar contraseña actual
    const validPassword = await bcrypt.compare(currentPassword, employee.password_hash);
    if (!validPassword) {
      throw new Error('Contraseña actual incorrecta');
    }
    
    // Validar nueva contraseña
    this.validatePasswordStrength(newPassword);
    
    // Verificar historial
    await this.checkPasswordHistory(employeeId, newPassword);
    
    // Hash y guardar
    const newHash = await bcrypt.hash(newPassword, 12);
    
    await prisma.$transaction([
      // Guardar en historial
      prisma.employee_password_history.create({
        data: {
          employee_id: employeeId,
          password_hash: employee.password_hash
        }
      }),
      // Actualizar contraseña
      prisma.employees.update({
        where: { id: employeeId },
        data: {
          password_hash: newHash,
          password_changed_at: new Date(),
          password_expires_at: new Date(Date.now() + SESSION_CONFIG.passwordExpiryDays * 24 * 60 * 60 * 1000),
          force_password_change: false
        }
      })
    ]);
    
    // Revocar todas las sesiones excepto la actual
    await this.revokeAllSessions(employeeId);
  },
  
  async forcePasswordChange(employeeId: string, adminId: string) {
    await prisma.employees.update({
      where: { id: employeeId },
      data: { force_password_change: true }
    });
  },
  
  async resetPassword(employeeId: string, newPassword: string, adminId: string) {
    this.validatePasswordStrength(newPassword);
    
    const newHash = await bcrypt.hash(newPassword, 12);
    
    await prisma.employees.update({
      where: { id: employeeId },
      data: {
        password_hash: newHash,
        force_password_change: true, // Forzar cambio en primer login
        password_changed_at: null
      }
    });
    
    // Revocar todas las sesiones
    await this.revokeAllSessions(employeeId);
  },
  
  validatePasswordStrength(password: string): void {
    const errors: string[] = [];
    
    if (password.length < SESSION_CONFIG.passwordMinLength) {
      errors.push(`Mínimo ${SESSION_CONFIG.passwordMinLength} caracteres`);
    }
    
    if (SESSION_CONFIG.passwordRequireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Debe contener mayúsculas');
    }
    
    if (SESSION_CONFIG.passwordRequireLowercase && !/[a-z]/.test(password)) {
      errors.push('Debe contener minúsculas');
    }
    
    if (SESSION_CONFIG.passwordRequireNumber && !/[0-9]/.test(password)) {
      errors.push('Debe contener números');
    }
    
    if (SESSION_CONFIG.passwordRequireSpecial && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      errors.push('Debe contener caracteres especiales');
    }
    
    if (errors.length > 0) {
      throw new Error(`Contraseña débil: ${errors.join(', ')}`);
    }
  },
  
  async checkPasswordHistory(employeeId: string, newPassword: string): Promise<void> {
    const history = await prisma.employee_password_history.findMany({
      where: { employee_id: employeeId },
      orderBy: { created_at: 'desc' },
      take: SESSION_CONFIG.passwordHistoryCount
    });
    
    for (const entry of history) {
      const isReused = await bcrypt.compare(newPassword, entry.password_hash);
      if (isReused) {
        throw new Error(`No puedes usar una de las últimas ${SESSION_CONFIG.passwordHistoryCount} contraseñas`);
      }
    }
  },
  
  // -------------------------------------------
  // CLEANUP
  // -------------------------------------------
  
  async cleanupExpiredSessions() {
    const result = await prisma.employee_sessions.updateMany({
      where: {
        is_active: true,
        expires_at: { lt: new Date() }
      },
      data: {
        is_active: false,
        revoked_at: new Date(),
        revoke_reason: 'Expired'
      }
    });
    
    if (result.count > 0) {
      console.log(`🧹 ${result.count} sesiones expiradas limpiadas`);
    }
    
    return result.count;
  },
  
  async checkPasswordExpiry() {
    const expiredPasswords = await prisma.employees.findMany({
      where: {
        status: 'ACTIVE',
        password_expires_at: { lt: new Date() },
        force_password_change: false
      },
      select: { id: true, email: true }
    });
    
    if (expiredPasswords.length > 0) {
      await prisma.employees.updateMany({
        where: {
          id: { in: expiredPasswords.map(e => e.id) }
        },
        data: { force_password_change: true }
      });
      
      console.log(`🔑 ${expiredPasswords.length} empleados con contraseña expirada`);
    }
    
    return expiredPasswords.length;
  }
};
