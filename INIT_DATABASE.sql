-- Simply Backend v2.2.0 - Database Initialization

-- ========================================
-- 1. Crear primer SUPER_ADMIN
-- ========================================
-- Password: Admin123!
-- Hash generado con bcrypt rounds=12

INSERT INTO employees (id, email, first_name, last_name, password_hash, role, status, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'admin@simply.com',
  'Super',
  'Admin',
  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5koSni66y08K2',
  'SUPER_ADMIN',
  'ACTIVE',
  NOW(),
  NOW()
)
ON CONFLICT (email) DO NOTHING;

-- ========================================
-- 2. Verificar tablas creadas
-- ========================================
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public'
ORDER BY table_name;

-- ========================================
-- 3. Ver empleados
-- ========================================
SELECT id, email, first_name, last_name, role, status, created_at
FROM employees;

-- ========================================
-- 4. Stats
-- ========================================
SELECT 
  (SELECT COUNT(*) FROM employees) as total_employees,
  (SELECT COUNT(*) FROM employees WHERE status = 'ACTIVE') as active_employees,
  (SELECT COUNT(*) FROM users) as total_users,
  (SELECT COUNT(*) FROM leads) as total_leads;
