-- =============================================================================
-- ASSIGN ADMIN ROLE
-- =============================================================================
-- Run this in Supabase SQL Editor to grant admin access to a user.
--
-- STEPS:
-- 1. Replace 'YOUR_EMAIL_HERE' with the user's email
-- 2. Run this script in Supabase SQL Editor
-- 3. Copy the UUID from the output
-- 4. Add the UUID to ADMIN_WHITELIST in backend-API_TallyFinance/src/admin/guards/admin.guard.ts
-- 5. Deploy the backend
-- =============================================================================

-- Set the email of the user to make admin
DO $$
DECLARE
  target_email TEXT := 'YOUR_EMAIL_HERE';  -- <-- CHANGE THIS
  target_user_id UUID;
BEGIN
  -- Find the user
  SELECT id INTO target_user_id
  FROM auth.users
  WHERE email = target_email;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found with email: %', target_email;
  END IF;

  -- Update app_metadata to include admin role
  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object(
    'role', 'admin',
    'admin_granted_at', NOW()::TEXT,
    'admin_granted_by', 'manual-sql'
  )
  WHERE id = target_user_id;

  -- Output the UUID (you need this for the whitelist)
  RAISE NOTICE '=== ADMIN ASSIGNED ===';
  RAISE NOTICE 'Email: %', target_email;
  RAISE NOTICE 'UUID: %', target_user_id;
  RAISE NOTICE '';
  RAISE NOTICE 'NEXT STEP: Add this UUID to ADMIN_WHITELIST in:';
  RAISE NOTICE 'backend-API_TallyFinance/src/admin/guards/admin.guard.ts';
  RAISE NOTICE '';
  RAISE NOTICE 'Example:';
  RAISE NOTICE 'const ADMIN_WHITELIST: string[] = [';
  RAISE NOTICE '  ''%'',', target_user_id;
  RAISE NOTICE '];';
END $$;

-- Verify the assignment
SELECT
  id,
  email,
  raw_app_meta_data->>'role' as role,
  raw_app_meta_data->>'admin_granted_at' as granted_at
FROM auth.users
WHERE raw_app_meta_data->>'role' = 'admin';
