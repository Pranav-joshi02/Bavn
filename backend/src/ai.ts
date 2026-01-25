import axios from "axios";

export async function askGroq(questions: string[]) {

  const prompt = `
You are helping a student fill Google Forms.
Answer each question clearly and briefly.

Questions:
${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}
`;

  const res = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }]
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  const text = res.data.choices[0].message.content;

  return text
    .split("\n")
    .filter((l: string) => l.trim())
    .map((l: string) => l.replace(/^\d+\.?\s*/, ""));
}
