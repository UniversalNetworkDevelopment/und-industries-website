const axios = require('axios');

async function qwepSearch(query) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`;
    const { data } = await axios.get(url);
    return data;
  } catch (err) {
    console.error(`[Qwep][WebSearch] Search Error:`, err.message);
    return null;
  }
}

module.exports = { qwepSearch };
