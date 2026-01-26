import { FastifyInstance } from "fastify";
import { authGuard } from "./auth.js";
import { askGroq } from "./ai.js";
import { supabase } from "./supabase.js";

export async function routes(app: FastifyInstance) {

  // health
  app.get("/", async () => ({ status: "ok" }));


  // get AI answers
  app.post(
    "/api/answers",
    { preHandler: authGuard },
    async (req: any) => {

      const { questions } = req.body;

     const userId = req.user.id;
const answers: string[] = [];

for (const q of questions) {

  // 1️⃣ check memory first
  const { data } = await supabase
    .from("answers")
    .select("answer")
    .eq("user_id", userId)
    .ilike("question", `%${q.slice(0, 40)}%`)
    .limit(1);

  if (data && data.length > 0) {

    // ✅ reuse old answer
    answers.push(data[0].answer);

  } else {

    // 🤖 ask AI
    const ai = await askGroq([q]);
    const ans = ai[0] || "";

    answers.push(ans);

    // 💾 save new memory
    await supabase.from("answers").insert({
      user_id: userId,
      question: q,
      answer: ans
    });
  }
}

return { answers };

    }
  );


  // get previous answers
  app.get(
    "/api/memory",
    { preHandler: authGuard },
    async (req: any) => {

      const { data } = await supabase
        .from("answers")
        .select("*")
        .eq("user_id", req.user.id)
        .order("created_at", { ascending: false })
        .limit(50);

      return { data };
    }
  );
}
