import { PrismaClient, Prisma } from '@prisma/client';
import { transferService } from './transferService';

const prisma = new PrismaClient();

const MAX_CONTACTS = 50;

interface CreateContactRequest {
  userId: string;
  alias?: string;
  cvu: string;
  nickname?: string;
}

export const contactsService = {
  // ==========================================
  // CREAR CONTACTO
  // ==========================================

  async create(req: CreateContactRequest) {
    const { userId, alias, cvu, nickname } = req;

    // Validar límite de contactos
    const count = await prisma.contacts.count({ where: { user_id: userId } });
    if (count >= MAX_CONTACTS) {
      throw new Error(`Límite de ${MAX_CONTACTS} contactos alcanzado`);
    }

    // Validar CVU/Alias
    const destination = alias 
      ? await transferService.validateDestination(alias)
      : await transferService.validateDestination(cvu);

    if (!destination.valid) {
      throw new Error(destination.error || 'Destino inválido');
    }

    // Verificar que no exista ya
    const existing = await prisma.contacts.findFirst({
      where: { user_id: userId, cvu: destination.cvu }
    });

    if (existing) {
      throw new Error('Este contacto ya existe en tu agenda');
    }

    // Verificar que no sea el mismo usuario
    const userAccount = await prisma.accounts.findFirst({
      where: { user_id: userId }
    });

    if (userAccount && userAccount.cvu === destination.cvu) {
      throw new Error('No puedes agregarte a ti mismo como contacto');
    }

    // Crear contacto
    const contact = await prisma.contacts.create({
      data: {
        user_id: userId,
        name: destination.holderName || nickname || 'Sin nombre',
        cvu: destination.cvu,
        alias: alias || null,
        bank: destination.bank || null,
        nickname: nickname || null,
        transfer_count: 0
      }
    });

    return contact;
  },

  // ==========================================
  // LISTAR CONTACTOS
  // ==========================================

  async list(userId: string, params?: { 
    orderBy?: 'name' | 'frequency' | 'recent';
    search?: string;
  }) {
    const { orderBy = 'frequency', search } = params || {};

    const where: any = { user_id: userId };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { nickname: { contains: search, mode: 'insensitive' } },
        { alias: { contains: search, mode: 'insensitive' } },
        { cvu: { contains: search } }
      ];
    }

    let orderByClause: any;
    switch (orderBy) {
      case 'name':
        orderByClause = { name: 'asc' };
        break;
      case 'recent':
        orderByClause = { last_transfer_at: 'desc' };
        break;
      case 'frequency':
      default:
        orderByClause = { transfer_count: 'desc' };
        break;
    }

    const contacts = await prisma.contacts.findMany({
      where,
      orderBy: orderByClause
    });

    return {
      contacts,
      total: contacts.length,
      limit: MAX_CONTACTS
    };
  },

  // ==========================================
  // OBTENER CONTACTO
  // ==========================================

  async get(userId: string, contactId: string) {
    const contact = await prisma.contacts.findFirst({
      where: { id: contactId, user_id: userId }
    });

    if (!contact) {
      throw new Error('Contacto no encontrado');
    }

    return contact;
  },

  // ==========================================
  // ACTUALIZAR CONTACTO
  // ==========================================

  async update(userId: string, contactId: string, data: { nickname?: string }) {
    const contact = await prisma.contacts.findFirst({
      where: { id: contactId, user_id: userId }
    });

    if (!contact) {
      throw new Error('Contacto no encontrado');
    }

    return prisma.contacts.update({
      where: { id: contactId },
      data: { nickname: data.nickname }
    });
  },

  // ==========================================
  // ELIMINAR CONTACTO
  // ==========================================

  async delete(userId: string, contactId: string) {
    const contact = await prisma.contacts.findFirst({
      where: { id: contactId, user_id: userId }
    });

    if (!contact) {
      throw new Error('Contacto no encontrado');
    }

    await prisma.contacts.delete({ where: { id: contactId } });

    return { success: true };
  },

  // ==========================================
  // INCREMENTAR CONTADOR (llamado después de transferir)
  // ==========================================

  async incrementTransferCount(userId: string, cvu: string) {
    const contact = await prisma.contacts.findFirst({
      where: { user_id: userId, cvu }
    });

    if (contact) {
      await prisma.contacts.update({
        where: { id: contact.id },
        data: {
          transfer_count: { increment: 1 },
          last_transfer_at: new Date()
        }
      });
    }
  },

  // ==========================================
  // OBTENER CONTACTOS FRECUENTES
  // ==========================================

  async getFrequent(userId: string, limit: number = 5) {
    return prisma.contacts.findMany({
      where: { user_id: userId, transfer_count: { gt: 0 } },
      orderBy: { transfer_count: 'desc' },
      take: limit
    });
  },

  // ==========================================
  // OBTENER CONTACTOS RECIENTES
  // ==========================================

  async getRecent(userId: string, limit: number = 5) {
    return prisma.contacts.findMany({
      where: { user_id: userId, last_transfer_at: { not: null } },
      orderBy: { last_transfer_at: 'desc' },
      take: limit
    });
  }
};
