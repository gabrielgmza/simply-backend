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

-- ============================================
-- USUARIO DE PRUEBA - Gabriel Dario Galdeano
-- ============================================
INSERT INTO users (
  id, email, phone, first_name, last_name, dni, cuil,
  address_street, address_number, address_floor, address_apt,
  address_city, address_state, address_country,
  status, kyc_status, user_level, points_balance, lifetime_points,
  created_at, updated_at
) VALUES (
  'test-user-gabriel-galdeano',
  'gabriel.galdeano@paysur.com.ar',
  '+5492612514663',
  'Gabriel Dario',
  'Galdeano',
  '33094813',
  '20330948133',
  'Av España',
  '948',
  '11',
  '11004',
  'Mendoza',
  'Mendoza',
  'AR',
  'ACTIVE',
  'APPROVED',
  'DIAMANTE',
  10000,
  50000,
  NOW(),
  NOW()
) ON CONFLICT (dni) DO UPDATE SET
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  cuil = EXCLUDED.cuil,
  phone = EXCLUDED.phone,
  address_street = EXCLUDED.address_street,
  address_number = EXCLUDED.address_number,
  address_floor = EXCLUDED.address_floor,
  address_apt = EXCLUDED.address_apt,
  address_city = EXCLUDED.address_city,
  address_state = EXCLUDED.address_state,
  user_level = EXCLUDED.user_level,
  updated_at = NOW();

-- Cuenta del usuario de prueba
INSERT INTO accounts (
  id, user_id, cvu, alias, balance, created_at, updated_at
) SELECT
  'test-account-gabriel-galdeano',
  u.id,
  '0000072000330948130000',
  'gabriel.galdeano.paysur',
  1000000,
  NOW(),
  NOW()
FROM users u WHERE u.dni = '33094813'
ON CONFLICT (user_id) DO NOTHING;
