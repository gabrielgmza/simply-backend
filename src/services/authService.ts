import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { generateAccessToken, generateRefreshToken } from '../utils/jwt';

const prisma = new PrismaClient();
const SALT_ROUNDS = 12;

export const authService = {
  async login(email: string, password: string) {
    // Buscar empleado
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
        avatar_url: true
      }
    });

    if (!employee) {
      throw new Error('Credenciales inválidas');
    }

    // Verificar estado
    if (employee.status !== 'ACTIVE') {
      throw new Error('Cuenta suspendida o inactiva');
    }

    // Verificar contraseña
    const validPassword = await bcrypt.compare(password, employee.password_hash);
    if (!validPassword) {
      throw new Error('Credenciales inválidas');
    }

    // Actualizar last_login
    await prisma.employees.update({
      where: { id: employee.id },
      data: { 
        last_login_at: new Date(),
        last_activity_at: new Date()
      }
    });

    // Generar tokens
    const payload = {
      id: employee.id,
      email: employee.email,
      role: employee.role
    };

    const token = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    // Estructura compatible con el frontend (snake_case)
    return {
      token,
      refreshToken,
      employee: {
        id: employee.id,
        email: employee.email,
        first_name: employee.first_name,
        last_name: employee.last_name,
        role: employee.role,
        avatar_url: employee.avatar_url
      }
    };
  },

  async register(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role: string;
  }) {
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
        role: true
      }
    });

    return employee;
  },

  async updateActivity(employeeId: string) {
    await prisma.employees.update({
      where: { id: employeeId },
      data: { last_activity_at: new Date() }
    });
  }
};
