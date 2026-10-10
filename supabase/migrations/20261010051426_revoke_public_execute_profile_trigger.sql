/*
# Remove public execution from profile trigger

1. Security
- Revokes default PUBLIC execution on the SECURITY DEFINER profile trigger function.
- The function remains available to the database trigger that creates workspace profiles during signup.

2. Important Notes
- No user data is changed.
- Direct REST/RPC calls cannot invoke the profile creation function.
*/

REVOKE EXECUTE ON FUNCTION public.handle_new_workspace_profile() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_workspace_profile() FROM anon, authenticated;
