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

      const answers = await askGroq(questions);

      // save memory
      const rows = questions.map((q: string, i: number) => ({
        user_id: req.user.id,
        question: q,
        answer: answers[i]
      }));

      await supabase.from("answers").insert(rows);

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
