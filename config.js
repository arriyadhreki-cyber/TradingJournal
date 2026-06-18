// ============================================================
// KONFIGURASI SUPABASE
// ============================================================
// Project URL & Anon Key didapat dari:
// Supabase Dashboard → Settings → API
const SUPABASE_URL = "https://bwkjlpwyixfufynbqffi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3a2pscHd5aXhmdWZ5bmJxZmZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2OTU3MzUsImV4cCI6MjA5NzI3MTczNX0._i518F8cVAaGV0geGIRR27yKBfg4mykIml2w85nfcfE";

// Inisialisasi Supabase Client (dipakai di semua halaman)
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
