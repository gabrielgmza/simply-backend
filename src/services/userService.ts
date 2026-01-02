import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const userService = {
  async getById(id: string) {
    const user = await prisma.users.findUnique({
      where: { id }
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
        kyc_status: status as any
      }
    });

    return user;
  },

  async getActivity(userId: string, limit: number = 20) {
    // Simulación de actividad - en producción vendría de múltiples tablas
    const activity: any[] = [];
    
    // Por ahora devolvemos vacío, se puede expandir después
    return activity;
  },

  async updateStatus(id: string, status: string) {
    const user = await prisma.users.update({
      where: { id },
      data: {
        status: status as any,
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
