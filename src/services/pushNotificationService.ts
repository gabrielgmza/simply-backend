import { PrismaClient, Prisma } from '@prisma/client';
import admin from 'firebase-admin';

const prisma = new PrismaClient();

// Inicializar Firebase Admin
let firebaseApp: admin.app.App | null = null;

const initFirebase = () => {
  if (firebaseApp) return firebaseApp;

  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  
  if (!serviceAccount) {
    console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT no configurado - notificaciones deshabilitadas');
    return null;
  }

  try {
    const credentials = JSON.parse(serviceAccount);
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(credentials)
    });
    console.log('✅ Firebase Admin inicializado');
    return firebaseApp;
  } catch (error) {
    console.error('❌ Error inicializando Firebase:', error);
    return null;
  }
};

// Tipos de notificación
export enum NotificationType {
  // Transaccionales
  TRANSFER_RECEIVED = 'transfer_received',
  TRANSFER_SENT = 'transfer_sent',
  PAYMENT_RECEIVED = 'payment_received',
  FCI_RETURN_CREDITED = 'fci_return_credited',
  INSTALLMENT_DUE_SOON = 'installment_due_soon',
  INSTALLMENT_OVERDUE = 'installment_overdue',
  INSTALLMENT_PAID = 'installment_paid',
  
  // KYC/Cuenta
  KYC_APPROVED = 'kyc_approved',
  KYC_REJECTED = 'kyc_rejected',
  ACCOUNT_CREATED = 'account_created',
  LEVEL_UPGRADED = 'level_upgraded',
  
  // Seguridad
  NEW_LOGIN = 'new_login',
  SUSPICIOUS_ACTIVITY = 'suspicious_activity',
  CARD_BLOCKED = 'card_blocked',
  PASSWORD_CHANGED = 'password_changed',
  
  // Promocionales
  NEW_FEATURE = 'new_feature',
  REFERRAL_REWARD = 'referral_reward',
  SPECIAL_OFFER = 'special_offer',
  REWARDS_EARNED = 'rewards_earned'
}

interface NotificationPayload {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
  priority?: 'high' | 'normal';
  saveToDb?: boolean;
}

interface BatchNotificationPayload {
  userIds: string[];
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export const pushNotificationService = {
  // ==========================================
  // REGISTRAR TOKEN FCM
  // ==========================================

  async registerToken(userId: string, token: string, platform: 'ios' | 'android' | 'web') {
    // Verificar si el token ya existe para otro usuario (limpiar)
    await prisma.users.updateMany({
      where: { fcm_token: token, id: { not: userId } },
      data: { fcm_token: null }
    });

    // Actualizar token del usuario
    await prisma.users.update({
      where: { id: userId },
      data: { 
        fcm_token: token,
        preferences: {
          ...((await prisma.users.findUnique({ where: { id: userId } }))?.preferences as object || {}),
          push_platform: platform,
          push_enabled: true
        }
      }
    });

    return { success: true };
  },

  // ==========================================
  // ELIMINAR TOKEN
  // ==========================================

  async removeToken(userId: string) {
    await prisma.users.update({
      where: { id: userId },
      data: { fcm_token: null }
    });

    return { success: true };
  },

  // ==========================================
  // ENVIAR NOTIFICACIÓN INDIVIDUAL
  // ==========================================

  async send(payload: NotificationPayload) {
    const { userId, type, title, body, data = {}, imageUrl, priority = 'high', saveToDb = true } = payload;

    // Obtener token del usuario
    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: { fcm_token: true, preferences: true }
    });

    if (!user) {
      throw new Error('Usuario no encontrado');
    }

    // Verificar preferencias de notificación
    const prefs = user.preferences as Record<string, any> || {};
    if (prefs.push_enabled === false) {
      console.log(`Notificaciones deshabilitadas para usuario ${userId}`);
      return { success: false, reason: 'notifications_disabled' };
    }

    // Guardar en DB
    let notificationId: string | null = null;
    if (saveToDb) {
      const notification = await prisma.user_notifications.create({
        data: {
          user_id: userId,
          title,
          body,
          type,
          data: data as any,
          read: false
        }
      });
      notificationId = notification.id;
    }

    // Si no hay token, solo guardamos en DB
    if (!user.fcm_token) {
      return { 
        success: true, 
        notificationId, 
        sent: false, 
        reason: 'no_token' 
      };
    }

    // Enviar via FCM
    const app = initFirebase();
    if (!app) {
      return { 
        success: true, 
        notificationId, 
        sent: false, 
        reason: 'firebase_not_configured' 
      };
    }

    try {
      const message: admin.messaging.Message = {
        token: user.fcm_token,
        notification: {
          title,
          body,
          ...(imageUrl && { imageUrl })
        },
        data: {
          ...data,
          type,
          notificationId: notificationId || '',
          click_action: 'FLUTTER_NOTIFICATION_CLICK'
        },
        android: {
          priority: priority === 'high' ? 'high' : 'normal',
          notification: {
            channelId: this.getChannelId(type),
            icon: 'ic_notification',
            color: '#6366F1'
          }
        },
        apns: {
          payload: {
            aps: {
              alert: { title, body },
              sound: 'default',
              badge: await this.getUnreadCount(userId),
              'mutable-content': 1
            }
          },
          fcmOptions: {
            ...(imageUrl && { imageUrl })
          }
        }
      };

      const response = await admin.messaging().send(message);
      
      return { 
        success: true, 
        notificationId, 
        sent: true, 
        messageId: response 
      };
    } catch (error: any) {
      console.error('Error enviando push:', error);

      // Si el token es inválido, limpiarlo
      if (error.code === 'messaging/invalid-registration-token' ||
          error.code === 'messaging/registration-token-not-registered') {
        await this.removeToken(userId);
      }

      return { 
        success: true, 
        notificationId, 
        sent: false, 
        error: error.message 
      };
    }
  },

  // ==========================================
  // ENVIAR A MÚLTIPLES USUARIOS
  // ==========================================

  async sendBatch(payload: BatchNotificationPayload) {
    const { userIds, type, title, body, data = {} } = payload;

    // Obtener tokens
    const users = await prisma.users.findMany({
      where: { 
        id: { in: userIds },
        fcm_token: { not: null }
      },
      select: { id: true, fcm_token: true }
    });

    const tokens = users.map(u => u.fcm_token!).filter(Boolean);

    if (tokens.length === 0) {
      return { success: true, sent: 0, total: userIds.length };
    }

    // Guardar en DB para todos
    await prisma.user_notifications.createMany({
      data: userIds.map(userId => ({
        user_id: userId,
        title,
        body,
        type,
        data: data as any,
        read: false
      }))
    });

    const app = initFirebase();
    if (!app) {
      return { success: true, sent: 0, total: userIds.length, reason: 'firebase_not_configured' };
    }

    try {
      const message: admin.messaging.MulticastMessage = {
        tokens,
        notification: { title, body },
        data: { ...data, type },
        android: {
          priority: 'high',
          notification: {
            channelId: this.getChannelId(type),
            icon: 'ic_notification',
            color: '#6366F1'
          }
        },
        apns: {
          payload: {
            aps: {
              alert: { title, body },
              sound: 'default'
            }
          }
        }
      };

      const response = await admin.messaging().sendEachForMulticast(message);

      // Limpiar tokens inválidos
      const failedTokens = response.responses
        .map((res, idx) => (!res.success ? tokens[idx] : null))
        .filter(Boolean);

      if (failedTokens.length > 0) {
        await prisma.users.updateMany({
          where: { fcm_token: { in: failedTokens as string[] } },
          data: { fcm_token: null }
        });
      }

      return {
        success: true,
        sent: response.successCount,
        failed: response.failureCount,
        total: userIds.length
      };
    } catch (error: any) {
      console.error('Error en batch push:', error);
      return { success: false, error: error.message };
    }
  },

  // ==========================================
  // NOTIFICACIONES TRANSACCIONALES
  // ==========================================

  async notifyTransferReceived(userId: string, amount: number, senderName: string) {
    return this.send({
      userId,
      type: NotificationType.TRANSFER_RECEIVED,
      title: '💰 Recibiste una transferencia',
      body: `${senderName} te envió $${amount.toLocaleString('es-AR')}`,
      data: { 
        screen: 'transactions',
        amount: amount.toString()
      }
    });
  },

  async notifyTransferSent(userId: string, amount: number, recipientName: string) {
    return this.send({
      userId,
      type: NotificationType.TRANSFER_SENT,
      title: '✅ Transferencia enviada',
      body: `Enviaste $${amount.toLocaleString('es-AR')} a ${recipientName}`,
      data: { screen: 'transactions' }
    });
  },

  async notifyFCIReturn(userId: string, amount: number) {
    return this.send({
      userId,
      type: NotificationType.FCI_RETURN_CREDITED,
      title: '📈 Rendimiento acreditado',
      body: `Se acreditaron $${amount.toLocaleString('es-AR')} de rendimientos FCI`,
      data: { screen: 'investments' }
    });
  },

  async notifyInstallmentDueSoon(userId: string, amount: number, dueDate: Date, daysLeft: number) {
    return this.send({
      userId,
      type: NotificationType.INSTALLMENT_DUE_SOON,
      title: '⏰ Cuota próxima a vencer',
      body: `Tu cuota de $${amount.toLocaleString('es-AR')} vence en ${daysLeft} día${daysLeft > 1 ? 's' : ''}`,
      data: { screen: 'financings' }
    });
  },

  async notifyInstallmentOverdue(userId: string, amount: number, daysOverdue: number) {
    return this.send({
      userId,
      type: NotificationType.INSTALLMENT_OVERDUE,
      title: '⚠️ Cuota vencida',
      body: `Tu cuota de $${amount.toLocaleString('es-AR')} está vencida hace ${daysOverdue} día${daysOverdue > 1 ? 's' : ''}`,
      data: { screen: 'financings' },
      priority: 'high'
    });
  },

  async notifyKYCApproved(userId: string) {
    return this.send({
      userId,
      type: NotificationType.KYC_APPROVED,
      title: '🎉 ¡Cuenta verificada!',
      body: 'Tu identidad fue verificada exitosamente. Ya podés operar sin límites.',
      data: { screen: 'home' }
    });
  },

  async notifyLevelUpgrade(userId: string, newLevel: string) {
    const levelEmojis: Record<string, string> = {
      ORO: '🥇',
      BLACK: '🖤',
      DIAMANTE: '💎'
    };
    
    return this.send({
      userId,
      type: NotificationType.LEVEL_UPGRADED,
      title: `${levelEmojis[newLevel] || '🎉'} ¡Subiste de nivel!`,
      body: `Ahora sos cliente ${newLevel}. Disfrutá de nuevos beneficios.`,
      data: { screen: 'profile' }
    });
  },

  async notifyNewLogin(userId: string, device: string, location: string) {
    return this.send({
      userId,
      type: NotificationType.NEW_LOGIN,
      title: '🔐 Nuevo inicio de sesión',
      body: `Se inició sesión desde ${device} en ${location}`,
      data: { screen: 'security' },
      priority: 'high'
    });
  },

  // ==========================================
  // HELPERS
  // ==========================================

  getChannelId(type: NotificationType): string {
    if (type.includes('security') || type.includes('suspicious') || type.includes('blocked')) {
      return 'security';
    }
    if (type.includes('transfer') || type.includes('payment') || type.includes('installment')) {
      return 'transactions';
    }
    if (type.includes('fci') || type.includes('investment')) {
      return 'investments';
    }
    if (type.includes('offer') || type.includes('reward') || type.includes('feature')) {
      return 'promotions';
    }
    return 'general';
  },

  async getUnreadCount(userId: string): Promise<number> {
    return prisma.user_notifications.count({
      where: { user_id: userId, read: false }
    });
  },

  // ==========================================
  // GESTIÓN DE NOTIFICACIONES EN APP
  // ==========================================

  async getNotifications(userId: string, params?: { page?: number; limit?: number; unreadOnly?: boolean }) {
    const { page = 1, limit = 20, unreadOnly = false } = params || {};

    const where: any = { user_id: userId };
    if (unreadOnly) where.read = false;

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.user_notifications.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.user_notifications.count({ where }),
      prisma.user_notifications.count({ where: { user_id: userId, read: false } })
    ]);

    return {
      notifications,
      unreadCount,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    };
  },

  async markAsRead(userId: string, notificationIds: string[]) {
    await prisma.user_notifications.updateMany({
      where: { id: { in: notificationIds }, user_id: userId },
      data: { read: true, read_at: new Date() }
    });
    return { success: true };
  },

  async markAllAsRead(userId: string) {
    await prisma.user_notifications.updateMany({
      where: { user_id: userId, read: false },
      data: { read: true, read_at: new Date() }
    });
    return { success: true };
  }
};
