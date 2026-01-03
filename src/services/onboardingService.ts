import { PrismaClient, Prisma } from '@prisma/client';
import { accountService } from './accountService';
import { pushNotificationService, NotificationType } from './pushNotificationService';
import { auditLogService } from './backoffice/auditLogService';
import crypto from 'crypto';
import argon2 from 'argon2';

const prisma = new PrismaClient();

// Tiempo de expiración de códigos OTP (5 minutos)
const OTP_EXPIRY_MINUTES = 5;

interface RegistrationSession {
  id: string;
  email: string;
  phone?: string;
  phoneVerified: boolean;
  step: 'email' | 'phone' | 'otp' | 'password' | 'personal' | 'kyc' | 'complete';
  expiresAt: Date;
}

interface PersonalData {
  firstName: string;
  lastName: string;
  dni: string;
  birthDate: string;
  gender?: 'M' | 'F' | 'X';
  nationality?: string;
  address?: {
    street: string;
    number: string;
    floor?: string;
    apt?: string;
    city: string;
    state: string;
    zip?: string;
  };
}

export const onboardingService = {
  // ==========================================
  // PASO 1: INICIAR REGISTRO (Email)
  // ==========================================

  async startRegistration(email: string) {
    // Validar formato email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Email inválido');
    }

    // Verificar si ya existe
    const existing = await prisma.users.findUnique({ where: { email } });
    if (existing) {
      throw new Error('Este email ya está registrado. ¿Querés iniciar sesión?');
    }

    // Crear sesión de registro
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutos

    await prisma.registration_sessions.create({
      data: {
        id: sessionId,
        email,
        step: 'phone',
        expires_at: expiresAt
      }
    });

    return {
      sessionId,
      email,
      nextStep: 'phone',
      expiresAt
    };
  },

  // ==========================================
  // PASO 2: AGREGAR TELÉFONO
  // ==========================================

  async setPhone(sessionId: string, phone: string) {
    const session = await this.getValidSession(sessionId);

    // Limpiar y validar teléfono
    const cleanPhone = phone.replace(/[\s\-()]/g, '');
    if (!/^\+?[0-9]{10,15}$/.test(cleanPhone)) {
      throw new Error('Número de teléfono inválido');
    }

    // Normalizar a formato internacional
    let normalizedPhone = cleanPhone;
    if (!normalizedPhone.startsWith('+')) {
      normalizedPhone = '+54' + normalizedPhone.replace(/^0/, '');
    }

    // Verificar si ya existe
    const existing = await prisma.users.findFirst({ where: { phone: normalizedPhone } });
    if (existing) {
      throw new Error('Este teléfono ya está registrado');
    }

    // Generar OTP
    const otp = this.generateOTP();
    const otpExpiry = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await prisma.registration_sessions.update({
      where: { id: sessionId },
      data: {
        phone: normalizedPhone,
        otp_code: otp,
        otp_expires_at: otpExpiry,
        otp_attempts: 0,
        step: 'otp'
      }
    });

    // TODO: Enviar SMS real
    // Por ahora, en desarrollo, devolvemos el OTP
    const isDev = process.env.NODE_ENV !== 'production';

    // Simular envío de SMS
    console.log(`📱 OTP para ${normalizedPhone}: ${otp}`);

    return {
      phone: normalizedPhone,
      nextStep: 'otp',
      otpSent: true,
      ...(isDev && { devOtp: otp }) // Solo en desarrollo
    };
  },

  // ==========================================
  // PASO 3: VERIFICAR OTP
  // ==========================================

  async verifyOTP(sessionId: string, otp: string) {
    const session = await this.getValidSession(sessionId);

    if (!session.otp_code || !session.otp_expires_at) {
      throw new Error('No hay código OTP pendiente');
    }

    // Verificar expiración
    if (new Date() > session.otp_expires_at) {
      throw new Error('El código ha expirado. Solicitá uno nuevo.');
    }

    // Verificar intentos
    if ((session.otp_attempts || 0) >= 3) {
      throw new Error('Demasiados intentos. Solicitá un nuevo código.');
    }

    // Verificar código
    if (session.otp_code !== otp) {
      await prisma.registration_sessions.update({
        where: { id: sessionId },
        data: { otp_attempts: { increment: 1 } }
      });
      throw new Error(`Código incorrecto. Te quedan ${2 - (session.otp_attempts || 0)} intentos.`);
    }

    // Marcar como verificado
    await prisma.registration_sessions.update({
      where: { id: sessionId },
      data: {
        phone_verified: true,
        otp_code: null,
        step: 'password'
      }
    });

    return {
      phoneVerified: true,
      nextStep: 'password'
    };
  },

  // ==========================================
  // PASO 4: ESTABLECER CONTRASEÑA
  // ==========================================

  async setPassword(sessionId: string, password: string) {
    const session = await this.getValidSession(sessionId);

    if (!session.phone_verified) {
      throw new Error('Primero debés verificar tu teléfono');
    }

    // Validar contraseña
    const passwordErrors = this.validatePassword(password);
    if (passwordErrors.length > 0) {
      throw new Error(passwordErrors.join('. '));
    }

    // Hash de contraseña
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4
    });

    await prisma.registration_sessions.update({
      where: { id: sessionId },
      data: {
        password_hash: passwordHash,
        step: 'personal'
      }
    });

    return {
      nextStep: 'personal'
    };
  },

  validatePassword(password: string): string[] {
    const errors: string[] = [];

    if (password.length < 8) {
      errors.push('Mínimo 8 caracteres');
    }
    if (!/[A-Z]/.test(password)) {
      errors.push('Al menos una mayúscula');
    }
    if (!/[a-z]/.test(password)) {
      errors.push('Al menos una minúscula');
    }
    if (!/[0-9]/.test(password)) {
      errors.push('Al menos un número');
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      errors.push('Al menos un carácter especial');
    }

    return errors;
  },

  // ==========================================
  // PASO 5: DATOS PERSONALES
  // ==========================================

  async setPersonalData(sessionId: string, data: PersonalData) {
    const session = await this.getValidSession(sessionId);

    if (!session.password_hash) {
      throw new Error('Primero debés establecer tu contraseña');
    }

    // Validar DNI
    if (!/^\d{7,8}$/.test(data.dni)) {
      throw new Error('DNI inválido (7-8 dígitos)');
    }

    // Verificar DNI único
    const existingDni = await prisma.users.findFirst({ where: { dni: data.dni } });
    if (existingDni) {
      throw new Error('Este DNI ya está registrado');
    }

    // Validar fecha de nacimiento (mayor de 18)
    const birthDate = new Date(data.birthDate);
    const age = (Date.now() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (age < 18) {
      throw new Error('Debés ser mayor de 18 años');
    }
    if (age > 120) {
      throw new Error('Fecha de nacimiento inválida');
    }

    await prisma.registration_sessions.update({
      where: { id: sessionId },
      data: {
        personal_data: data as any,
        step: 'kyc'
      }
    });

    return {
      nextStep: 'kyc'
    };
  },

  // ==========================================
  // PASO 6: INICIAR KYC
  // ==========================================

  async startKYC(sessionId: string) {
    const session = await this.getValidSession(sessionId);

    if (!session.personal_data) {
      throw new Error('Primero completá tus datos personales');
    }

    // TODO: Integrar con didit
    // Por ahora, simulamos la sesión de KYC
    const kycSessionId = crypto.randomUUID();

    await prisma.registration_sessions.update({
      where: { id: sessionId },
      data: { kyc_session_id: kycSessionId }
    });

    // En producción, esto vendría de didit
    const kycUrl = `https://verify.didit.me/session/${kycSessionId}`;

    return {
      kycSessionId,
      kycUrl,
      instructions: [
        'Tené a mano tu DNI',
        'Asegurate de tener buena iluminación',
        'Seguí las instrucciones en pantalla'
      ]
    };
  },

  // ==========================================
  // PASO 7: COMPLETAR REGISTRO
  // ==========================================

  async completeRegistration(sessionId: string, kycApproved: boolean = false) {
    const session = await this.getValidSession(sessionId);

    if (!session.personal_data || !session.password_hash || !session.phone) {
      throw new Error('Faltan datos para completar el registro');
    }

    const personalData = session.personal_data as unknown as PersonalData;

    // Crear usuario
    const user = await prisma.$transaction(async (tx) => {
      // Crear usuario
      const newUser = await tx.users.create({
        data: {
          email: session.email,
          phone: session.phone,
          password_hash: session.password_hash,
          first_name: personalData.firstName,
          last_name: personalData.lastName,
          dni: personalData.dni,
          birth_date: new Date(personalData.birthDate),
          gender: personalData.gender,
          nationality: personalData.nationality || 'AR',
          address_street: personalData.address?.street,
          address_number: personalData.address?.number,
          address_floor: personalData.address?.floor,
          address_apt: personalData.address?.apt,
          address_city: personalData.address?.city,
          address_state: personalData.address?.state,
          address_zip: personalData.address?.zip,
          status: 'ACTIVE',
          kyc_status: kycApproved ? 'APPROVED' : 'PENDING',
          user_level: 'PLATA',
          points_balance: 0,
          lifetime_points: 0
        }
      });

      // Generar CVU
      await accountService.generateCVU(newUser.id);

      // Eliminar sesión de registro
      await tx.registration_sessions.delete({ where: { id: sessionId } });

      return newUser;
    });

    // Obtener cuenta creada
    const account = await prisma.accounts.findUnique({ where: { user_id: user.id } });

    // Audit log
    await auditLogService.log({
      action: 'USER_REGISTERED',
      actorType: 'user',
      actorId: user.id,
      resource: 'user',
      resourceId: user.id,
      description: `Nuevo usuario registrado: ${user.email}`,
      metadata: { kycApproved }
    });

    // Enviar notificación de bienvenida
    await pushNotificationService.send({
      userId: user.id,
      type: NotificationType.ACCOUNT_CREATED,
      title: '¡Bienvenido a Simply! 🎉',
      body: 'Tu cuenta está lista. Empezá a invertir y disfrutá de los beneficios.',
      data: { screen: 'home' }
    });

    return {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        level: user.user_level
      },
      account: {
        cvu: account?.cvu,
        alias: account?.alias
      },
      nextSteps: kycApproved 
        ? ['Realizá tu primera inversión', 'Explorá los beneficios de tu nivel']
        : ['Completá la verificación de identidad para operar sin límites']
    };
  },

  // ==========================================
  // HELPERS
  // ==========================================

  async getValidSession(sessionId: string) {
    const session = await prisma.registration_sessions.findUnique({
      where: { id: sessionId }
    });

    if (!session) {
      throw new Error('Sesión no encontrada. Iniciá el registro nuevamente.');
    }

    if (new Date() > session.expires_at) {
      await prisma.registration_sessions.delete({ where: { id: sessionId } });
      throw new Error('La sesión ha expirado. Iniciá el registro nuevamente.');
    }

    return session;
  },

  generateOTP(): string {
    return crypto.randomInt(100000, 999999).toString();
  },

  // ==========================================
  // REENVIAR OTP
  // ==========================================

  async resendOTP(sessionId: string) {
    const session = await this.getValidSession(sessionId);

    if (!session.phone) {
      throw new Error('No hay teléfono registrado');
    }

    // Rate limit: 1 OTP cada 60 segundos
    if (session.otp_expires_at) {
      const timeSinceLastOtp = Date.now() - (session.otp_expires_at.getTime() - OTP_EXPIRY_MINUTES * 60 * 1000);
      if (timeSinceLastOtp < 60000) {
        const waitSeconds = Math.ceil((60000 - timeSinceLastOtp) / 1000);
        throw new Error(`Esperá ${waitSeconds} segundos antes de solicitar otro código`);
      }
    }

    const otp = this.generateOTP();
    const otpExpiry = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await prisma.registration_sessions.update({
      where: { id: sessionId },
      data: {
        otp_code: otp,
        otp_expires_at: otpExpiry,
        otp_attempts: 0
      }
    });

    // TODO: Enviar SMS real
    console.log(`📱 OTP reenviado para ${session.phone}: ${otp}`);

    const isDev = process.env.NODE_ENV !== 'production';

    return {
      sent: true,
      phone: session.phone.replace(/.(?=.{4})/g, '*'), // Enmascarar
      ...(isDev && { devOtp: otp })
    };
  },

  // ==========================================
  // OBTENER ESTADO DE REGISTRO
  // ==========================================

  async getRegistrationStatus(sessionId: string) {
    const session = await this.getValidSession(sessionId);

    return {
      sessionId,
      email: session.email,
      phone: session.phone ? session.phone.replace(/.(?=.{4})/g, '*') : null,
      phoneVerified: session.phone_verified,
      hasPassword: !!session.password_hash,
      hasPersonalData: !!session.personal_data,
      kycSessionId: session.kyc_session_id,
      currentStep: session.step,
      expiresAt: session.expires_at,
      steps: {
        email: true,
        phone: !!session.phone,
        otp: session.phone_verified,
        password: !!session.password_hash,
        personal: !!session.personal_data,
        kyc: !!session.kyc_session_id,
        complete: false
      }
    };
  }
};
