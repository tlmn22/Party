import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example)');
}

// Service-role client: backend is trusted, RLS is bypassed here on purpose.
// Every route must authorize via requireAuth before touching this client.
export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
