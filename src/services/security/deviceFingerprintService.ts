import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

// ============================================
// DEVICE FINGERPRINTING SERVICE
// Identifica y trackea dispositivos por usuario
// ============================================

export type DeviceTrustLevel = 'TRUSTED' | 'KNOWN' | 'NEW' | 'UNTRUSTED';

export interface DeviceInfo {
  id: string;
  userId: string;
  fingerprint: string;
  trustLevel: DeviceTrustLevel;
  
  // Metadata del dispositivo
  platform: 'ios' | 'android' | 'web' | 'unknown';
  osVersion?: string;
  appVersion?: string;
  deviceModel?: string;
  screenResolution?: string;
  timezone?: string;
  language?: string;
  
  // Tracking
  firstSeenAt: Date;
  lastSeenAt: Date;
  loginCount: number;
  successfulOps: number;
  failedOps: number;
  
  // Trust factors
  trustFactors: DeviceTrustFactor[];
  
  // Status
  isBlocked: boolean;
  blockedReason?: string;
}

interface DeviceTrustFactor {
  factor: string;
  value: boolean | string | number;
  impact: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
}

interface FingerprintData {
  // Browser/App info
  userAgent: string;
  platform: string;
  
  // Screen
  screenWidth?: number;
  screenHeight?: number;
  colorDepth?: number;
  pixelRatio?: number;
  
  // Timezone & Language
  timezone?: string;
  language?: string;
  languages?: string[];
  
  // Hardware
  hardwareConcurrency?: number;
  deviceMemory?: number;
  
  // Canvas fingerprint (hash)
  canvasHash?: string;
  
  // WebGL info
  webglVendor?: string;
  webglRenderer?: string;
  
  // Audio fingerprint (hash)
  audioHash?: string;
  
  // Fonts (hash of available fonts)
  fontsHash?: string;
  
  // Mobile specific
  deviceId?: string;          // IDFV/Android ID
  advertisingId?: string;     // IDFA/GAID (si disponible)
  isEmulator?: boolean;
  isRooted?: boolean;
  
  // App specific
  appVersion?: string;
  buildNumber?: string;
}

export const deviceFingerprintService = {
  // ==========================================
  // GENERAR FINGERPRINT
  // ==========================================

  generateFingerprint(data: FingerprintData): string {
    // Crear string concatenado de características estables
    const components = [
      data.userAgent,
      data.platform,
      `${data.screenWidth}x${data.screenHeight}`,
      data.colorDepth,
      data.timezone,
      data.language,
      data.hardwareConcurrency,
      data.canvasHash,
      data.webglVendor,
      data.webglRenderer,
      data.fontsHash,
      data.deviceId
    ].filter(Boolean);

    // Hash SHA-256
    const hash = crypto.createHash('sha256');
    hash.update(components.join('|'));
    return hash.digest('hex').substring(0, 32);
  },

  // ==========================================
  // REGISTRAR/ACTUALIZAR DISPOSITIVO
  // ==========================================

  async registerDevice(userId: string, fingerprintData: FingerprintData, ipAddress: string): Promise<DeviceInfo> {
    const fingerprint = this.generateFingerprint(fingerprintData);

    // Buscar dispositivo existente
    let device = await prisma.user_devices.findFirst({
      where: {
        user_id: userId,
        fingerprint
      }
    });

    if (device) {
      // Actualizar último uso
      device = await prisma.user_devices.update({
        where: { id: device.id },
        data: {
          last_seen_at: new Date(),
          login_count: { increment: 1 },
          last_ip: ipAddress,
          app_version: fingerprintData.appVersion,
          metadata: {
            ...((device.metadata as object) || {}),
            lastUpdate: new Date().toISOString()
          }
        }
      });
    } else {
      // Crear nuevo dispositivo
      const platform = this.detectPlatform(fingerprintData);
      
      device = await prisma.user_devices.create({
        data: {
          user_id: userId,
          fingerprint,
          platform,
          os_version: this.extractOSVersion(fingerprintData.userAgent),
          device_model: this.extractDeviceModel(fingerprintData.userAgent),
          app_version: fingerprintData.appVersion,
          screen_resolution: `${fingerprintData.screenWidth}x${fingerprintData.screenHeight}`,
          timezone: fingerprintData.timezone,
          language: fingerprintData.language,
          trust_level: 'NEW',
          first_seen_at: new Date(),
          last_seen_at: new Date(),
          last_ip: ipAddress,
          login_count: 1,
          successful_ops: 0,
          failed_ops: 0,
          is_blocked: false,
          is_emulator: fingerprintData.isEmulator || false,
          is_rooted: fingerprintData.isRooted || false,
          metadata: {
            canvasHash: fingerprintData.canvasHash,
            webglVendor: fingerprintData.webglVendor,
            webglRenderer: fingerprintData.webglRenderer,
            audioHash: fingerprintData.audioHash,
            fontsHash: fingerprintData.fontsHash
          }
        }
      });

      // Notificar nuevo dispositivo
      await this.notifyNewDevice(userId, device);
    }

    // Calcular factores de confianza
    const trustFactors = await this.calculateTrustFactors(device);

    return this.mapToDeviceInfo(device, trustFactors);
  },

  // ==========================================
  // OBTENER DISPOSITIVO
  // ==========================================

  async getDevice(userId: string, fingerprint: string): Promise<DeviceInfo | null> {
    const device = await prisma.user_devices.findFirst({
      where: {
        user_id: userId,
        fingerprint
      }
    });

    if (!device) return null;

    const trustFactors = await this.calculateTrustFactors(device);
    return this.mapToDeviceInfo(device, trustFactors);
  },

  // ==========================================
  // LISTAR DISPOSITIVOS DEL USUARIO
  // ==========================================

  async getUserDevices(userId: string): Promise<DeviceInfo[]> {
    const devices = await prisma.user_devices.findMany({
      where: { user_id: userId },
      orderBy: { last_seen_at: 'desc' }
    });

    return Promise.all(
      devices.map(async (d) => {
        const factors = await this.calculateTrustFactors(d);
        return this.mapToDeviceInfo(d, factors);
      })
    );
  },

  // ==========================================
  // MARCAR COMO CONFIABLE
  // ==========================================

  async trustDevice(userId: string, deviceId: string): Promise<DeviceInfo> {
    const device = await prisma.user_devices.update({
      where: { id: deviceId, user_id: userId },
      data: {
        trust_level: 'TRUSTED',
        trusted_at: new Date()
      }
    });

    const trustFactors = await this.calculateTrustFactors(device);
    return this.mapToDeviceInfo(device, trustFactors);
  },

  // ==========================================
  // BLOQUEAR DISPOSITIVO
  // ==========================================

  async blockDevice(userId: string, deviceId: string, reason: string): Promise<DeviceInfo> {
    const device = await prisma.user_devices.update({
      where: { id: deviceId, user_id: userId },
      data: {
        trust_level: 'UNTRUSTED',
        is_blocked: true,
        blocked_reason: reason,
        blocked_at: new Date()
      }
    });

    // Invalidar sesiones de este dispositivo
    await prisma.user_sessions.updateMany({
      where: {
        user_id: userId,
        device_fingerprint: device.fingerprint
      },
      data: {
        is_valid: false,
        invalidated_reason: 'device_blocked'
      }
    });

    const trustFactors = await this.calculateTrustFactors(device);
    return this.mapToDeviceInfo(device, trustFactors);
  },

  // ==========================================
  // REGISTRAR OPERACIÓN
  // ==========================================

  async recordOperation(userId: string, fingerprint: string, success: boolean) {
    await prisma.user_devices.updateMany({
      where: {
        user_id: userId,
        fingerprint
      },
      data: success
        ? { successful_ops: { increment: 1 } }
        : { failed_ops: { increment: 1 } }
    });

    // Si muchos fallos, degradar confianza
    if (!success) {
      const device = await prisma.user_devices.findFirst({
        where: { user_id: userId, fingerprint }
      });

      if (device && device.failed_ops >= 5 && device.trust_level !== 'UNTRUSTED') {
        await prisma.user_devices.update({
          where: { id: device.id },
          data: { trust_level: 'KNOWN' } // Degradar de TRUSTED a KNOWN
        });
      }
    }
  },

  // ==========================================
  // CALCULAR FACTORES DE CONFIANZA
  // ==========================================

  async calculateTrustFactors(device: any): Promise<DeviceTrustFactor[]> {
    const factors: DeviceTrustFactor[] = [];

    // Antigüedad del dispositivo
    const ageDays = (Date.now() - device.first_seen_at.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > 90) {
      factors.push({ factor: 'DEVICE_AGE_90D', value: true, impact: 'POSITIVE' });
    } else if (ageDays > 30) {
      factors.push({ factor: 'DEVICE_AGE_30D', value: true, impact: 'POSITIVE' });
    } else if (ageDays < 1) {
      factors.push({ factor: 'NEW_DEVICE', value: true, impact: 'NEGATIVE' });
    }

    // Frecuencia de uso
    if (device.login_count >= 20) {
      factors.push({ factor: 'FREQUENT_USE', value: device.login_count, impact: 'POSITIVE' });
    }

    // Ratio éxito/fallo
    const totalOps = device.successful_ops + device.failed_ops;
    if (totalOps > 0) {
      const successRate = device.successful_ops / totalOps;
      if (successRate >= 0.95) {
        factors.push({ factor: 'HIGH_SUCCESS_RATE', value: successRate, impact: 'POSITIVE' });
      } else if (successRate < 0.7) {
        factors.push({ factor: 'LOW_SUCCESS_RATE', value: successRate, impact: 'NEGATIVE' });
      }
    }

    // Emulador/Rooteado
    if (device.is_emulator) {
      factors.push({ factor: 'EMULATOR_DETECTED', value: true, impact: 'NEGATIVE' });
    }
    if (device.is_rooted) {
      factors.push({ factor: 'ROOTED_DEVICE', value: true, impact: 'NEGATIVE' });
    }

    // Marcado como confiable
    if (device.trusted_at) {
      factors.push({ factor: 'USER_TRUSTED', value: true, impact: 'POSITIVE' });
    }

    // Bloqueado
    if (device.is_blocked) {
      factors.push({ factor: 'BLOCKED', value: device.blocked_reason, impact: 'NEGATIVE' });
    }

    return factors;
  },

  // ==========================================
  // HELPERS
  // ==========================================

  detectPlatform(data: FingerprintData): 'ios' | 'android' | 'web' | 'unknown' {
    const ua = data.userAgent.toLowerCase();
    if (ua.includes('iphone') || ua.includes('ipad')) return 'ios';
    if (ua.includes('android')) return 'android';
    if (ua.includes('mozilla') || ua.includes('chrome') || ua.includes('safari')) return 'web';
    return 'unknown';
  },

  extractOSVersion(userAgent: string): string {
    // iOS
    const iosMatch = userAgent.match(/OS (\d+[._]\d+)/);
    if (iosMatch) return `iOS ${iosMatch[1].replace('_', '.')}`;

    // Android
    const androidMatch = userAgent.match(/Android (\d+\.?\d*)/);
    if (androidMatch) return `Android ${androidMatch[1]}`;

    // Windows
    const winMatch = userAgent.match(/Windows NT (\d+\.\d+)/);
    if (winMatch) return `Windows ${winMatch[1]}`;

    // macOS
    const macMatch = userAgent.match(/Mac OS X (\d+[._]\d+)/);
    if (macMatch) return `macOS ${macMatch[1].replace('_', '.')}`;

    return 'Unknown';
  },

  extractDeviceModel(userAgent: string): string {
    // iPhone
    const iphoneMatch = userAgent.match(/iPhone(\d+,\d+)?/);
    if (iphoneMatch) return 'iPhone';

    // iPad
    if (userAgent.includes('iPad')) return 'iPad';

    // Android device
    const androidMatch = userAgent.match(/;\s*([^;]+)\s*Build/);
    if (androidMatch) return androidMatch[1].trim();

    return 'Unknown';
  },

  async notifyNewDevice(userId: string, device: any) {
    // Crear notificación
    await prisma.user_notifications.create({
      data: {
        user_id: userId,
        title: '🔐 Nuevo dispositivo detectado',
        body: `Se inició sesión desde ${device.device_model || 'un nuevo dispositivo'} (${device.platform})`,
        type: 'new_device',
        data: {
          deviceId: device.id,
          platform: device.platform,
          model: device.device_model
        }
      }
    });

    // TODO: Enviar push notification
  },

  mapToDeviceInfo(device: any, trustFactors: DeviceTrustFactor[]): DeviceInfo {
    return {
      id: device.id,
      userId: device.user_id,
      fingerprint: device.fingerprint,
      trustLevel: device.trust_level as DeviceTrustLevel,
      platform: device.platform,
      osVersion: device.os_version,
      appVersion: device.app_version,
      deviceModel: device.device_model,
      screenResolution: device.screen_resolution,
      timezone: device.timezone,
      language: device.language,
      firstSeenAt: device.first_seen_at,
      lastSeenAt: device.last_seen_at,
      loginCount: device.login_count,
      successfulOps: device.successful_ops,
      failedOps: device.failed_ops,
      trustFactors,
      isBlocked: device.is_blocked,
      blockedReason: device.blocked_reason
    };
  },

  // ==========================================
  // VERIFICAR SI DISPOSITIVO ESTÁ PERMITIDO
  // ==========================================

  async isDeviceAllowed(userId: string, fingerprint: string): Promise<{ allowed: boolean; reason?: string }> {
    const device = await prisma.user_devices.findFirst({
      where: {
        user_id: userId,
        fingerprint
      }
    });

    // Dispositivo nuevo: permitir pero flaggear
    if (!device) {
      return { allowed: true };
    }

    // Bloqueado
    if (device.is_blocked) {
      return { allowed: false, reason: device.blocked_reason || 'Dispositivo bloqueado' };
    }

    // Emulador + no trusted
    if (device.is_emulator && device.trust_level !== 'TRUSTED') {
      return { allowed: false, reason: 'Emulador no permitido' };
    }

    // Rooteado + alto riesgo
    if (device.is_rooted && device.trust_level !== 'TRUSTED') {
      return { allowed: false, reason: 'Dispositivo rooteado no permitido' };
    }

    return { allowed: true };
  },

  // ==========================================
  // ELIMINAR DISPOSITIVO
  // ==========================================

  async removeDevice(userId: string, deviceId: string): Promise<void> {
    await prisma.user_devices.delete({
      where: { id: deviceId, user_id: userId }
    });
  },

  // ==========================================
  // ESTADÍSTICAS DE DISPOSITIVOS
  // ==========================================

  async getDeviceStats(userId: string) {
    const devices = await prisma.user_devices.findMany({
      where: { user_id: userId }
    });

    return {
      total: devices.length,
      trusted: devices.filter(d => d.trust_level === 'TRUSTED').length,
      blocked: devices.filter(d => d.is_blocked).length,
      platforms: {
        ios: devices.filter(d => d.platform === 'ios').length,
        android: devices.filter(d => d.platform === 'android').length,
        web: devices.filter(d => d.platform === 'web').length
      },
      recentlyActive: devices.filter(d => 
        Date.now() - d.last_seen_at.getTime() < 7 * 24 * 60 * 60 * 1000
      ).length
    };
  }
};
