import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const SALT_ROUNDS = 12;

export const employeeService = {
  async getAll(filters: {
    page?: number;
    limit?: number;
    search?: string;
    role?: string;
    status?: string;
  }) {
    const { page = 1, limit = 20, search = '', role, status } = filters;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { first_name: { contains: search, mode: 'insensitive' } },
        { last_name: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (role) where.role = role;
    if (status) where.status = status;

    const [employees, total] = await Promise.all([
      prisma.employees.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          email: true,
          first_name: true,
          last_name: true,
          role: true,
          status: true,
          avatar_url: true,
          last_login_at: true,
          last_activity_at: true,
          created_at: true
        }
      }),
      prisma.employees.count({ where })
    ]);

    return {
      employees,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  },

  async getById(id: string) {
    const employee = await prisma.employees.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        role: true,
        status: true,
        avatar_url: true,
        preferences: true,
        last_login_at: true,
        last_activity_at: true,
        created_at: true,
        updated_at: true
      }
    });

    if (!employee) {
      throw new Error('Empleado no encontrado');
    }

    return employee;
  },

  async create(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role: string;
  }) {
    // Verificar si el email ya existe
    const existing = await prisma.employees.findUnique({
      where: { email: data.email }
    });

    if (existing) {
      throw new Error('El email ya está registrado');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

    // Crear empleado
    const employee = await prisma.employees.create({
      data: {
        email: data.email,
        password_hash: passwordHash,
        first_name: data.firstName,
        last_name: data.lastName,
        role: data.role as any
      },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        role: true,
        status: true,
        created_at: true
      }
    });

    return employee;
  },

  async update(id: string, data: {
    firstName?: string;
    lastName?: string;
    role?: string;
    status?: string;
    avatarUrl?: string;
    preferences?: any;
  }) {
    const employee = await prisma.employees.update({
      where: { id },
      data: {
        first_name: data.firstName,
        last_name: data.lastName,
        role: data.role as any,
        status: data.status as any,
        avatar_url: data.avatarUrl,
        preferences: data.preferences
      },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        role: true,
        status: true,
        avatar_url: true,
        updated_at: true
      }
    });

    return employee;
  },

  async updatePassword(id: string, newPassword: string) {
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await prisma.employees.update({
      where: { id },
      data: { password_hash: passwordHash }
    });
  },

  async delete(id: string) {
    // Soft delete - cambiar estado a INACTIVE
    await prisma.employees.update({
      where: { id },
      data: { status: 'INACTIVE' }
    });
  },

  async getStats() {
    const [total, active, byRole] = await Promise.all([
      prisma.employees.count(),
      prisma.employees.count({ where: { status: 'ACTIVE' } }),
      prisma.employees.groupBy({
        by: ['role'],
        _count: true
      })
    ]);

    return {
      total,
      active,
      inactive: total - active,
      byRole
    };
  }
};
