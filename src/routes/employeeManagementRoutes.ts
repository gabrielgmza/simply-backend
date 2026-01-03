import { Router } from 'express';
import { authMiddleware, requirePermission, AuthRequest } from '../middleware/auth';
import { employeeManagementService } from '../services/backoffice/employeeManagementService';
import { userHistoryService } from '../services/backoffice/userHistoryService';
import { bcraService } from '../services/providers/bcraService';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const router = Router();
const prisma = new PrismaClient();

// ============================================
// GESTIÓN DE EMPLEADOS
// ============================================

// Listar empleados que puede gestionar
router.get('/employees/manageable', authMiddleware, requirePermission('employees:view'), async (req: AuthRequest, res) => {
  try {
    const employees = await employeeManagementService.getManageableEmployees(req.employee!.id);
    res.json({ success: true, data: employees });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Bloquear empleado
router.post('/employees/:id/block', authMiddleware, requirePermission('employees:update'), async (req: AuthRequest, res) => {
  try {
    const { reason, duration } = req.body;
    if (!reason) return res.status(400).json({ success: false, error: 'Razón requerida' });

    const result = await employeeManagementService.blockEmployee({
      targetEmployeeId: req.params.id,
      managerId: req.employee!.id,
      reason,
      duration
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(403).json({ success: false, error: error.message });
  }
});

// Desbloquear empleado
router.post('/employees/:id/unblock', authMiddleware, requirePermission('employees:update'), async (req: AuthRequest, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ success: false, error: 'Razón requerida' });

    const result = await employeeManagementService.unblockEmployee({
      targetEmployeeId: req.params.id,
      managerId: req.employee!.id,
      reason
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(403).json({ success: false, error: error.message });
  }
});

// Eliminar empleado (soft delete)
router.delete('/employees/:id', authMiddleware, requirePermission('employees:delete'), async (req: AuthRequest, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ success: false, error: 'Razón requerida' });

    const result = await employeeManagementService.deleteEmployee({
      targetEmployeeId: req.params.id,
      managerId: req.employee!.id,
      reason
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(403).json({ success: false, error: error.message });
  }
});

// Cambiar rol
router.post('/employees/:id/role', authMiddleware, requirePermission('employees:update'), async (req: AuthRequest, res) => {
  try {
    const { newRole, reason } = req.body;
    if (!newRole || !reason) return res.status(400).json({ success: false, error: 'newRole y reason requeridos' });

    const result = await employeeManagementService.changeRole({
      targetEmployeeId: req.params.id,
      managerId: req.employee!.id,
      newRole,
      reason
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(403).json({ success: false, error: error.message });
  }
});

// Historial de cambios de empleado
router.get('/employees/:id/history', authMiddleware, requirePermission('employees:view'), async (req: AuthRequest, res) => {
  try {
    const history = await employeeManagementService.getEmployeeHistory(req.params.id);
    res.json({ success: true, data: history });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ============================================
// HISTORIAL DE CAMBIOS DE USUARIOS
// ============================================

// Obtener historial de cambios de usuario
router.get('/users/:id/history', authMiddleware, requirePermission('users:view'), async (req: AuthRequest, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const field = req.query.field as string | undefined;
    
    const history = await userHistoryService.getHistory(req.params.id, { limit, field });
    res.json({ success: true, data: history });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Actualizar usuario con historial
router.patch('/users/:id', authMiddleware, requirePermission('users:update'), async (req: AuthRequest, res) => {
  try {
    const { reason, ...data } = req.body;

    const updated = await userHistoryService.updateUserWithHistory({
      userId: req.params.id,
      data,
      changedByType: 'employee',
      changedById: req.employee!.id,
      reason,
      ipAddress: req.ip
    });

    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Soft delete de usuario
router.delete('/users/:id', authMiddleware, requirePermission('users:delete'), async (req: AuthRequest, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ success: false, error: 'Razón requerida' });

    const result = await userHistoryService.softDeleteUser({
      userId: req.params.id,
      deletedByType: 'employee',
      deletedById: req.employee!.id,
      reason
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ============================================
// LEGAJO DE USUARIO (incluye Central de Deudores)
// ============================================

router.get('/users/:id/legajo', authMiddleware, requirePermission('users:view'), async (req: AuthRequest, res) => {
  try {
    const user = await prisma.users.findUnique({
      where: { id: req.params.id },
      include: {
        account: true,
        investments: { orderBy: { created_at: 'desc' }, take: 10 },
        financings: { orderBy: { created_at: 'desc' }, take: 10 },
        transactions: { orderBy: { created_at: 'desc' }, take: 20 },
        kyc_documents: true,
        risk_flags: { where: { resolved_at: null } },
        fraud_alerts: { orderBy: { created_at: 'desc' }, take: 5 },
        support_tickets: { orderBy: { created_at: 'desc' }, take: 5 }
      }
    });

    if (!user) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });

    // Consultar Central de Deudores BCRA
    let centralDeudores = null;
    try {
      centralDeudores = await bcraService.consultarLegajoUsuario(req.params.id);
    } catch (err) {
      console.warn('Error consultando Central de Deudores:', err);
    }

    // Historial de cambios reciente
    const changesHistory = await userHistoryService.getHistory(req.params.id, { limit: 20 });

    res.json({
      success: true,
      data: {
        ...user,
        centralDeudores,
        changesHistory
      }
    });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ============================================
// CREAR USUARIO DE PRUEBA
// ============================================

router.post('/users/seed-test', authMiddleware, requirePermission('users:create'), async (req: AuthRequest, res) => {
  try {
    const testUser = await prisma.users.upsert({
      where: { dni: '33094813' },
      update: {
        first_name: 'Gabriel Dario',
        last_name: 'Galdeano',
        cuil: '20330948133',
        phone: '+5492612514663',
        address_street: 'Av España',
        address_number: '948',
        address_floor: '11',
        address_apt: '11004',
        address_city: 'Mendoza',
        address_state: 'Mendoza',
        address_country: 'AR',
        status: 'ACTIVE',
        kyc_status: 'APPROVED',
        user_level: 'DIAMANTE'
      },
      create: {
        email: 'gabriel.galdeano@paysur.com.ar',
        phone: '+5492612514663',
        first_name: 'Gabriel Dario',
        last_name: 'Galdeano',
        dni: '33094813',
        cuil: '20330948133',
        address_street: 'Av España',
        address_number: '948',
        address_floor: '11',
        address_apt: '11004',
        address_city: 'Mendoza',
        address_state: 'Mendoza',
        address_country: 'AR',
        status: 'ACTIVE',
        kyc_status: 'APPROVED',
        user_level: 'DIAMANTE',
        points_balance: 10000,
        lifetime_points: 50000
      }
    });

    // Crear cuenta si no existe
    const existingAccount = await prisma.accounts.findUnique({ where: { user_id: testUser.id } });
    
    if (!existingAccount) {
      // Generar CVU único (22 dígitos)
      const cvuBase = '0000072' + '0' + '0' + testUser.dni!.padStart(8, '0') + '0';
      const cvu = cvuBase.padEnd(22, '0');
      
      await prisma.accounts.create({
        data: {
          user_id: testUser.id,
          cvu,
          alias: 'gabriel.galdeano.paysur',
          balance: 1000000, // $1M para pruebas
        }
      });
    }

    res.json({ success: true, data: testUser, message: 'Usuario de prueba creado/actualizado' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

export default router;
