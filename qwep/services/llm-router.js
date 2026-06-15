const axios = require('axios');

const OLLAMA_URL = "http://localhost:11434/api/generate";

async function qwepLLM(prompt, model = "deepseek-coder") {
  try {
    const { data } = await axios.post(OLLAMA_URL, {
      model,
      prompt,
      stream: false
    });
    return data.response;
  } catch (err) {
    console.error(`[Qwep][HomeBrain] LLM Error:`, err.message);
    throw err;
  }
}

function pickModel(serviceType) {
  switch (serviceType) {
    case "website":
      return "deepseek-coder";
    case "shopify":
      return "qwen2.5-coder";
    case "automation":
      return "llama3";
    default:
      return "deepseek-coder";
  }
}

module.exports = { qwepLLM, pickModel };
