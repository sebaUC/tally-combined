-- =============================================================================
-- REVOKE ADMIN ROLE
-- =============================================================================
-- Run this in Supabase SQL Editor to remove admin access from a user.
--
-- STEPS:
-- 1. Replace 'YOUR_EMAIL_HERE' with the user's email
-- 2. Run this script
-- 3. Remove the UUID from ADMIN_WHITELIST in backend-API_TallyFinance/src/admin/guards/admin.guard.ts
-- 4. Deploy the backend
-- =============================================================================

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

  -- Remove admin role from app_metadata
  UPDATE auth.users
  SET raw_app_meta_data = raw_app_meta_data - 'role' - 'admin_granted_at' - 'admin_granted_by'
  WHERE id = target_user_id;

  RAISE NOTICE '=== ADMIN REVOKED ===';
  RAISE NOTICE 'Email: %', target_email;
  RAISE NOTICE 'UUID: %', target_user_id;
  RAISE NOTICE '';
  RAISE NOTICE 'NEXT STEP: Remove this UUID from ADMIN_WHITELIST and deploy.';
END $$;
