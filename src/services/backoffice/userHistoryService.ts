import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// Campos sensibles que siempre se registran
const TRACKED_FIELDS = [
  'email', 'phone', 'first_name', 'last_name', 'dni', 'cuil',
  'address_street', 'address_number', 'address_floor', 'address_apt',
  'address_city', 'address_state', 'address_zip',
  'status', 'kyc_status', 'user_level', 'preferences'
];

export const userHistoryService = {
  // Registrar cambio de campo
  async logChange(params: {
    userId: string;
    fieldName: string;
    oldValue: any;
    newValue: any;
    changedByType: 'user' | 'employee' | 'system';
    changedById?: string;
    reason?: string;
    ipAddress?: string;
  }) {
    // Convertir valores a string para almacenar
    const oldStr = params.oldValue != null ? String(params.oldValue) : null;
    const newStr = params.newValue != null ? String(params.newValue) : null;

    // No registrar si no hay cambio real
    if (oldStr === newStr) return null;

    return prisma.user_changes_history.create({
      data: {
        user_id: params.userId,
        field_name: params.fieldName,
        old_value: oldStr,
        new_value: newStr,
        changed_by_type: params.changedByType,
        changed_by_id: params.changedById,
        reason: params.reason,
        ip_address: params.ipAddress
      }
    });
  },

  // Registrar múltiples cambios (para update de perfil)
  async logMultipleChanges(params: {
    userId: string;
    oldData: Record<string, any>;
    newData: Record<string, any>;
    changedByType: 'user' | 'employee' | 'system';
    changedById?: string;
    reason?: string;
    ipAddress?: string;
  }) {
    const changes = [];

    for (const field of TRACKED_FIELDS) {
      if (field in params.newData && params.oldData[field] !== params.newData[field]) {
        changes.push({
          user_id: params.userId,
          field_name: field,
          old_value: params.oldData[field] != null ? String(params.oldData[field]) : null,
          new_value: params.newData[field] != null ? String(params.newData[field]) : null,
          changed_by_type: params.changedByType,
          changed_by_id: params.changedById,
          reason: params.reason,
          ip_address: params.ipAddress
        });
      }
    }

    if (changes.length === 0) return [];

    await prisma.user_changes_history.createMany({ data: changes });
    return changes;
  },

  // Obtener historial de un usuario
  async getHistory(userId: string, params?: { limit?: number; field?: string }) {
    const where: any = { user_id: userId };
    if (params?.field) where.field_name = params.field;

    return prisma.user_changes_history.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: params?.limit || 100
    });
  },

  // Obtener versión anterior de un campo
  async getPreviousValue(userId: string, fieldName: string) {
    const lastChange = await prisma.user_changes_history.findFirst({
      where: { user_id: userId, field_name: fieldName },
      orderBy: { created_at: 'desc' }
    });

    return lastChange?.old_value;
  },

  // Soft delete de usuario (nunca se borra)
  async softDeleteUser(params: {
    userId: string;
    deletedByType: 'user' | 'employee' | 'system';
    deletedById?: string;
    reason: string;
  }) {
    const user = await prisma.users.findUnique({ where: { id: params.userId } });
    if (!user) throw new Error('Usuario no encontrado');

    await prisma.users.update({
      where: { id: params.userId },
      data: {
        is_deleted: true,
        deleted_at: new Date(),
        status: 'SUSPENDED'
      }
    });

    await this.logChange({
      userId: params.userId,
      fieldName: 'is_deleted',
      oldValue: false,
      newValue: true,
      changedByType: params.deletedByType,
      changedById: params.deletedById,
      reason: params.reason
    });

    return { success: true };
  },

  // Actualizar usuario con historial automático
  async updateUserWithHistory(params: {
    userId: string;
    data: Record<string, any>;
    changedByType: 'user' | 'employee' | 'system';
    changedById?: string;
    reason?: string;
    ipAddress?: string;
  }) {
    const currentUser = await prisma.users.findUnique({ where: { id: params.userId } });
    if (!currentUser) throw new Error('Usuario no encontrado');

    // Registrar cambios
    await this.logMultipleChanges({
      userId: params.userId,
      oldData: currentUser as any,
      newData: params.data,
      changedByType: params.changedByType,
      changedById: params.changedById,
      reason: params.reason,
      ipAddress: params.ipAddress
    });

    // Actualizar usuario
    const updated = await prisma.users.update({
      where: { id: params.userId },
      data: params.data
    });

    return updated;
  }
};
