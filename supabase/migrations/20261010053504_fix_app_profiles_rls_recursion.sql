/*
# Fix infinite RLS recursion on app_profiles

## Problem
The SELECT and DELETE policies on `app_profiles` contained subqueries
that reference `app_profiles` itself (e.g. `EXISTS (SELECT 1 FROM
app_profiles viewer WHERE ...)`). When PostgreSQL evaluates RLS on
`app_profiles`, the subquery triggers the same RLS policies again,
causing infinite recursion — error 42P17: "infinite recursion detected
in policy for relation app_profiles". This made every profile query
fail with HTTP 500, which blocked login entirely (the app loads the
user's profile immediately after sign-in).

## Fix
1. Create a SECURITY DEFINER function `is_workspace_admin()` that
   checks whether the current user's profile has role = 'admin'.
   Because the function is SECURITY DEFINER, it runs with the table
   owner's privileges and bypasses RLS — no recursion.
2. Rewrite the `app_profiles` SELECT policy to use `auth.uid()` for
   self-reads and `is_workspace_admin()` for admin reads, with no
   self-referential subquery.
3. Rewrite the `app_profiles` DELETE policy to use
   `is_workspace_admin()` instead of a self-referential subquery.

## Other tables
Other tables (app_documents, it_asset_events, it_assets, etc.) also
reference `app_profiles` in their policy subqueries. Those do NOT
recurse because they query a *different* table. Once the
`app_profiles` SELECT policy is non-recursive, those subqueries work
correctly — the user can see their own profile row, and the role check
succeeds.

## Security changes
- New SECURITY DEFINER function `is_workspace_admin()` (STABLE,
  search_path = public).
- Replaced `workspace profiles select` policy — same effective
  semantics (self-read or admin read), no recursion.
- Replaced `workspace profiles delete admin` policy — same effective
  semantics (admin-only delete), no recursion.
*/

-- 1. Create a SECURITY DEFINER helper to check admin role without
--    triggering RLS recursion on app_profiles.
CREATE OR REPLACE FUNCTION public.is_workspace_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- Grant execute to authenticated so RLS policies can call it.
GRANT EXECUTE ON FUNCTION public.is_workspace_admin() TO authenticated;

-- 2. Fix the SELECT policy — remove self-referential subquery.
DROP POLICY IF EXISTS "workspace profiles select" ON public.app_profiles;
CREATE POLICY "workspace profiles select"
  ON public.app_profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR public.is_workspace_admin());

-- 3. Fix the DELETE policy — remove self-referential subquery.
DROP POLICY IF EXISTS "workspace profiles delete admin" ON public.app_profiles;
CREATE POLICY "workspace profiles delete admin"
  ON public.app_profiles FOR DELETE
  TO authenticated
  USING (public.is_workspace_admin());
