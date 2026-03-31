const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error("⚠️ WARNING: SUPABASE_URL or SUPABASE_KEY is missing from .env");
  console.error("⚠️ Your database connection will fail.");
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
