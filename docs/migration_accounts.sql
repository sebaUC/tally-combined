-- ============================================================
-- Migración: Tabla accounts + cambios en payment_method y transactions
-- Ejecutar en Supabase SQL Editor en orden
-- ============================================================

-- 1. Crear tabla accounts
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  institution TEXT,
  currency TEXT NOT NULL DEFAULT 'CLP',
  current_balance NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índice para queries por user_id
CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);

-- 2. Agregar FK account_id a payment_method
ALTER TABLE payment_method ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id);

-- 3. Agregar columnas a transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'expense'
  CHECK (type IN ('expense', 'income'));
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id);

-- Índice para queries por account_id
CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(user_id, type);

-- 4. Crear RPC para actualización atómica de balance
CREATE OR REPLACE FUNCTION update_account_balance(p_account_id UUID, p_delta NUMERIC)
RETURNS void AS $$
BEGIN
  UPDATE accounts SET
    current_balance = current_balance + p_delta,
    updated_at = now()
  WHERE id = p_account_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 5. Migración de datos existentes
-- NOTA: Ejecutar solo si ya hay datos en producción
-- ============================================================

-- 5a. Crear account por cada usuario que tiene payment_methods
INSERT INTO accounts (id, user_id, name, institution, currency, current_balance)
SELECT DISTINCT ON (pm.user_id)
  gen_random_uuid(),
  pm.user_id,
  COALESCE(pm.name, 'Cuenta Principal'),
  pm.institution,
  COALESCE(pm.currency, 'CLP'),
  0
FROM payment_method pm
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a WHERE a.user_id = pm.user_id
);

-- 5b. Vincular payment_methods a sus nuevas accounts
UPDATE payment_method pm
SET account_id = a.id
FROM accounts a
WHERE pm.user_id = a.user_id
  AND pm.account_id IS NULL;

-- 5c. Copiar account_id a transactions desde payment_method
UPDATE transactions t
SET account_id = pm.account_id
FROM payment_method pm
WHERE t.payment_method_id = pm.id
  AND t.account_id IS NULL;

-- 5d. Para transacciones sin payment_method, asignar la primera cuenta del usuario
UPDATE transactions t
SET account_id = (
  SELECT a.id FROM accounts a WHERE a.user_id = t.user_id LIMIT 1
)
WHERE t.account_id IS NULL;

-- 5e. Calcular balance inicial de cada account (todas las transacciones son expense por default)
UPDATE accounts a
SET current_balance = COALESCE((
  SELECT SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END)
  FROM transactions t
  WHERE t.account_id = a.id
), 0);

-- 6. Enable RLS on accounts (match other tables)
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

-- Policy: users can only see their own accounts
CREATE POLICY "Users can view own accounts" ON accounts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own accounts" ON accounts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own accounts" ON accounts
  FOR UPDATE USING (auth.uid() = user_id);

-- Service role bypass (for backend)
CREATE POLICY "Service role full access accounts" ON accounts
  FOR ALL USING (auth.role() = 'service_role');
