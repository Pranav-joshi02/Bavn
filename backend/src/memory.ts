import { supabase } from "./supabase.js";

/* Save answer */
export async function saveAnswer(userId: string, question: string, answer: string) {
  await supabase.from("answers").insert({
    user_id: userId,
    question,
    answer
  });
}

/* Find similar previous answer (simple version) */
export async function findPreviousAnswer(userId: string, question: string) {

  const { data } = await supabase
    .from("answers")
    .select("question, answer")
    .eq("user_id", userId)
    .limit(50);

  if (!data) return null;

  const q = question.toLowerCase();

  for (const row of data) {
    if (q.includes(row.question.toLowerCase().slice(0, 12))) {
      return row.answer;
    }
  }

  return null;
}
