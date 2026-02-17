-- =============================================================================
-- LIST ALL ADMINS
-- =============================================================================
-- Run this in Supabase SQL Editor to see all users with admin role.
-- =============================================================================

SELECT
  id as uuid,
  email,
  raw_app_meta_data->>'role' as role,
  raw_app_meta_data->>'admin_granted_at' as granted_at,
  raw_app_meta_data->>'admin_granted_by' as granted_by,
  created_at as user_created_at
FROM auth.users
WHERE raw_app_meta_data->>'role' = 'admin'
ORDER BY raw_app_meta_data->>'admin_granted_at' DESC;
