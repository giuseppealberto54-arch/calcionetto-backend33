const aiCache = {};

function todayKey(type) {
  const d = new Date();
  return `ai_${type}_${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
}

async function callClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'web-search-2025-03-05'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { prompt, type } = req.body;
  if (!prompt || !type) return res.status(400).json({ error: 'Manca prompt o type' });

  const key = todayKey(type);
  if (aiCache[key]) {
    return res.status(200).json({ result: aiCache[key], cached: true });
  }

  try {
    const result = await callClaude(prompt);
    aiCache[key] = result;
    return res.status(200).json({ result, cached: false });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
