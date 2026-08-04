-- Guillotine app profiles (separate from BJF profiles table)
CREATE TABLE IF NOT EXISTS guillotine_profiles (
  id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        text UNIQUE NOT NULL,
  display_name text,
  role         text NOT NULL DEFAULT 'member',
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE guillotine_profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "Own profile readable"
  ON guillotine_profiles FOR SELECT
  USING (auth.uid() = id);

-- Admins can read all profiles
CREATE POLICY "Admin read all profiles"
  ON guillotine_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM guillotine_profiles gp
      WHERE gp.id = auth.uid() AND gp.role = 'admin'
    )
  );

-- Users can upsert their own profile on login
CREATE POLICY "Own profile upsert"
  ON guillotine_profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Own profile update"
  ON guillotine_profiles FOR UPDATE
  USING (auth.uid() = id);

GRANT SELECT, INSERT, UPDATE ON guillotine_profiles TO authenticated;

-- Set yourself as admin (run AFTER you first log in so the row exists)
-- UPDATE guillotine_profiles SET role = 'admin' WHERE email = 'wsjones4193@gmail.com';
