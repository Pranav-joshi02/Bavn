import Fastify from "fastify";
import { routes } from "./routes.js";

console.log("ENV CHECK:", process.env.SUPABASE_URL);

const app = Fastify({ logger: true });

app.register(routes);

const port = Number(process.env.PORT || 4000);

app.listen({ port }, () => {
  console.log("🚀 Backend running on http://localhost:" + port);
});
