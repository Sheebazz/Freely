require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;

if (!SUPABASE_URL) {
  throw new Error("SUPABASE_URL is not configured");
}

if (!SUPABASE_SECRET_KEY) {
  throw new Error("SUPABASE_SECRET_KEY is not configured");
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SECRET_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

module.exports = {
  supabase,
};
