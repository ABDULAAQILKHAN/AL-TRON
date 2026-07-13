import OpenAI from "openai";

// Initialize the standard OpenAI client
const ai = new OpenAI({
  baseURL: "https://models.inference.ai.azure.com", // The GitHub Proxy URL
  apiKey: "",             // Your GitHub PAT
});

async function testGitHubModel() {
  const response = await ai.chat.completions.create({
    model: "gpt-4o", // Or "claude-3-5-sonnet-20240620", "meta-llama-3.1-70b-instruct", etc.
    messages: [
      { role: "system", content: "You are Jarvis, a highly capable AI." },
      { role: "user", content: "what will you rate yourself in terms of agentic coding paired with VScode copilot out of 10 when compared to claude opus 6 and Gemini 3 pro if we assume they both are 10 on 10 so what will you rate yourself against them" }
    ],
    temperature: 0.7,
  });

  console.log(response.choices[0].message.content);
}

testGitHubModel();
