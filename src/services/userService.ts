import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const userService = {
  async getById(id: string) {
    const user = await prisma.users.findUnique({
      where: { id },
      include: {
        // Agregar relaciones cuando existan
      }
    });

    if (!user) {
      throw new Error('Usuario no encontrado');
    }

    return user;
  },

  async updateKYCStatus(id: string, status: string, verifiedBy: string) {
    const user = await prisma.users.update({
      where: { id },
      data: {
        kyc_status: status,
        kyc_verified_at: status === 'approved' ? new Date() : null,
        kyc_verified_by: status === 'approved' ? verifiedBy : null
      }
    });

    return user;
  },

  async getActivity(userId: string, limit: number = 20) {
    // Simulación de actividad - en producción vendría de múltiples tablas
    const activity = [];
    
    // Por ahora devolvemos vacío, se puede expandir después
    return activity;
  },

  async updateStatus(id: string, status: string) {
    const user = await prisma.users.update({
      where: { id },
      data: {
        status,
        updated_at: new Date()
      }
    });

    return user;
  },

  async getStats(userId: string) {
    // Stats simuladas - expandir en producción
    return {
      totalInvestments: 0,
      totalTransactions: 0,
      accountBalance: 0,
      kycStatus: 'pending'
    };
  }
};
