import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  "https://airoigcdzeaglmmdbggf.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpcm9pZ2NkemVhZ2xtbWRiZ2dmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NDM3NzAsImV4cCI6MjA4NDQxOTc3MH0.8KipaMQE0H6XugixYlgQ6KWjj9eTiz5G6V7MnOpgZMI"
);
