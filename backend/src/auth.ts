import { FastifyRequest, FastifyReply } from "fastify";
import { supabase } from "./supabase.js";

export async function authGuard(req: FastifyRequest, res: FastifyReply) {

  const header = req.headers.authorization;
  if (!header) return res.status(401).send({ error: "No token" });

  const token = header.replace("Bearer ", "");

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return res.status(401).send({ error: "Invalid token" });
  }

  // @ts-ignore
  req.user = data.user;
}
