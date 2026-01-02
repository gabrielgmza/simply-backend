import { PrismaClient, Prisma } from '@prisma/client';
import { walletService } from './walletService';

const prisma = new PrismaClient();

// Motivos BCRA para transferencias
export const BCRA_MOTIVES = [
  'VAR', // Varios
  'ALQ', // Alquileres
  'CUO', // Cuotas
  'EXP', // Expensas
  'FAC', // Facturas
  'PRE', // Préstamos
  'SEG', // Seguros
  'HON', // Honorarios
  'HAB', // Haberes
  'JUB'  // Jubilaciones
];

// Comisión por transferencia (0.5%)
const TRANSFER_FEE_RATE = new Prisma.Decimal(0.5);

export const transferService = {
  // ============================================
  // TRANSFERIR
  // ============================================
  async transfer(userId: string, data: {
    destinationCVU?: string;
    destinationAlias?: string;
    amount: number;
    motive: string;
    reference?: string;
  }) {
    const { destinationCVU, destinationAlias, amount, motive, reference } = data;
    const amountDecimal = new Prisma.Decimal(amount);
    
    // Validaciones
    if (!destinationCVU && !destinationAlias) {
      throw new Error('Debes indicar CVU o alias destino');
    }
    
    if (!BCRA_MOTIVES.includes(motive)) {
      throw new Error('Motivo de transferencia inválido');
    }
    
    if (amountDecimal.lessThanOrEqualTo(0)) {
      throw new Error('El monto debe ser mayor a 0');
    }
    
    // Obtener cuenta origen
    const sourceAccount = await prisma.accounts.findUnique({
      where: { user_id: userId },
      include: {
        user: {
          select: { first_name: true, last_name: true }
        }
      }
    });
    
    if (!sourceAccount) {
      throw new Error('Cuenta origen no encontrada');
    }
    
    // Calcular comisión
    const fee = amountDecimal.mul(TRANSFER_FEE_RATE).div(100);
    const total = amountDecimal.add(fee);
    
    // Verificar saldo
    if (sourceAccount.balance.lessThan(total)) {
      throw new Error('Saldo insuficiente');
    }
    
    // Verificar límites
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const dailyTotal = await prisma.transactions.aggregate({
      where: {
        user_id: userId,
        type: 'TRANSFER_OUT',
        status: 'COMPLETED',
        created_at: { gte: today }
      },
      _sum: { amount: true }
    });
    
    const dailyUsed = dailyTotal._sum.amount || new Prisma.Decimal(0);
    if (dailyUsed.add(amountDecimal).greaterThan(sourceAccount.daily_limit)) {
      throw new Error('Límite diario de transferencias excedido');
    }
    
    // Buscar cuenta destino
    const destAccount = await prisma.accounts.findFirst({
      where: destinationCVU 
        ? { cvu: destinationCVU }
        : { alias: destinationAlias?.toLowerCase() },
      include: {
        user: {
          select: { first_name: true, last_name: true }
        }
      }
    });
    
    // Verificar que no sea la misma cuenta
    if (destAccount?.user_id === userId) {
      throw new Error('No puedes transferir a tu propia cuenta');
    }
    
    // Procesar transferencia
    const result = await prisma.$transaction(async (tx) => {
      // Descontar de origen
      await tx.accounts.update({
        where: { user_id: userId },
        data: {
          balance: { decrement: total }
        }
      });
      
      // Crear transacción saliente
      const outTransaction = await tx.transactions.create({
        data: {
          user_id: userId,
          type: 'TRANSFER_OUT',
          amount: amountDecimal,
          fee,
          total,
          source_cvu: sourceAccount.cvu,
          destination_cvu: destAccount?.cvu || destinationCVU,
          destination_alias: destAccount?.alias || destinationAlias,
          motive,
          reference,
          status: destAccount ? 'COMPLETED' : 'PROCESSING',  // Si es externo, queda procesando
          completed_at: destAccount ? new Date() : null,
          metadata: {
            destination_name: destAccount 
              ? `${destAccount.user.first_name} ${destAccount.user.last_name}`
              : 'Cuenta externa'
          }
        }
      });
      
      // Si el destino es interno, acreditar inmediatamente
      if (destAccount) {
        await tx.accounts.update({
          where: { user_id: destAccount.user_id },
          data: {
            balance: { increment: amountDecimal }
          }
        });
        
        // Crear transacción entrante
        await tx.transactions.create({
          data: {
            user_id: destAccount.user_id,
            type: 'TRANSFER_IN',
            amount: amountDecimal,
            fee: 0,
            total: amountDecimal,
            source_cvu: sourceAccount.cvu,
            destination_cvu: destAccount.cvu,
            motive,
            reference,
            status: 'COMPLETED',
            completed_at: new Date(),
            metadata: {
              source_name: `${sourceAccount.user.first_name} ${sourceAccount.user.last_name}`
            }
          }
        });
      }
      
      // Guardar/actualizar contacto
      await tx.contacts.upsert({
        where: {
          user_id_cvu: {
            user_id: userId,
            cvu: destAccount?.cvu || destinationCVU || ''
          }
        },
        create: {
          user_id: userId,
          cvu: destAccount?.cvu || destinationCVU || '',
          alias: destAccount?.alias || destinationAlias,
          name: destAccount 
            ? `${destAccount.user.first_name} ${destAccount.user.last_name}`
            : 'Cuenta externa',
          last_used: new Date()
        },
        update: {
          last_used: new Date()
        }
      });
      
      return outTransaction;
    });
    
    return {
      transaction: result,
      amount: amountDecimal,
      fee,
      total,
      destination: {
        cvu: destAccount?.cvu || destinationCVU,
        alias: destAccount?.alias || destinationAlias,
        name: destAccount 
          ? `${destAccount.user.first_name} ${destAccount.user.last_name}`
          : 'Cuenta externa'
      }
    };
  },
  
  // ============================================
  // OBTENER CONTACTOS
  // ============================================
  async getContacts(userId: string, options: {
    search?: string;
    favoritesOnly?: boolean;
    limit?: number;
  }) {
    const { search, favoritesOnly, limit = 50 } = options;
    
    const where: any = { user_id: userId };
    
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { alias: { contains: search, mode: 'insensitive' } },
        { cvu: { contains: search } }
      ];
    }
    
    if (favoritesOnly) {
      where.is_favorite = true;
    }
    
    const contacts = await prisma.contacts.findMany({
      where,
      orderBy: [
        { is_favorite: 'desc' },
        { last_used: 'desc' }
      ],
      take: limit
    });
    
    return contacts;
  },
  
  // ============================================
  // AGREGAR/ACTUALIZAR CONTACTO
  // ============================================
  async saveContact(userId: string, data: {
    cvu: string;
    alias?: string;
    name: string;
    isFavorite?: boolean;
  }) {
    const { cvu, alias, name, isFavorite } = data;
    
    // Validar CVU
    if (!/^\d{22}$/.test(cvu)) {
      throw new Error('CVU inválido');
    }
    
    const contact = await prisma.contacts.upsert({
      where: {
        user_id_cvu: { user_id: userId, cvu }
      },
      create: {
        user_id: userId,
        cvu,
        alias,
        name,
        is_favorite: isFavorite || false
      },
      update: {
        alias,
        name,
        is_favorite: isFavorite
      }
    });
    
    return contact;
  },
  
  // ============================================
  // ELIMINAR CONTACTO
  // ============================================
  async deleteContact(userId: string, contactId: string) {
    const contact = await prisma.contacts.findFirst({
      where: { id: contactId, user_id: userId }
    });
    
    if (!contact) {
      throw new Error('Contacto no encontrado');
    }
    
    await prisma.contacts.delete({
      where: { id: contactId }
    });
    
    return { deleted: true };
  },
  
  // ============================================
  // TOGGLE FAVORITO
  // ============================================
  async toggleFavorite(userId: string, contactId: string) {
    const contact = await prisma.contacts.findFirst({
      where: { id: contactId, user_id: userId }
    });
    
    if (!contact) {
      throw new Error('Contacto no encontrado');
    }
    
    const updated = await prisma.contacts.update({
      where: { id: contactId },
      data: { is_favorite: !contact.is_favorite }
    });
    
    return updated;
  },
  
  // ============================================
  // VALIDAR DESTINO
  // ============================================
  async validateDestination(identifier: string) {
    // Determinar si es CVU o alias
    const isCVU = /^\d{22}$/.test(identifier);
    
    if (!isCVU && !identifier.includes('.')) {
      throw new Error('Formato inválido. Usa CVU (22 dígitos) o alias (palabra.palabra.palabra)');
    }
    
    const account = await prisma.accounts.findFirst({
      where: isCVU 
        ? { cvu: identifier }
        : { alias: identifier.toLowerCase() },
      include: {
        user: {
          select: { first_name: true, last_name: true }
        }
      }
    });
    
    if (!account) {
      // Si no es interno, podría ser externo (BIND)
      return {
        found: false,
        external: true,
        cvu: isCVU ? identifier : null,
        alias: !isCVU ? identifier : null,
        message: 'Cuenta externa. La transferencia puede demorar hasta 24hs hábiles.'
      };
    }
    
    if (account.status !== 'ACTIVE') {
      throw new Error('La cuenta destino no está activa');
    }
    
    return {
      found: true,
      external: false,
      cvu: account.cvu,
      alias: account.alias,
      name: `${account.user.first_name} ${account.user.last_name}`,
      message: 'Transferencia instantánea dentro de Simply'
    };
  }
};
