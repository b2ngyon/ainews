import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: ['http://localhost:4200', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());

const cache = {
  data: null,
  timestamp: null,
  TTL: 5 * 60 * 1000
};

app.get('/api/news', async (req, res) => {
  try {
    if (cache.data && Date.now() - cache.timestamp < cache.TTL) {
      return res.json(cache.data);
    }

    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: `Generate exactly 5 current AI-related cybersecurity news items in JSON format. For each item, return:
{
  "title": "headline",
  "summary": "brief description",
  "severity": "Critical|High|Medium|Low",
  "category": "Vulnerability|Threat|Incident|Research",
  "timestamp": "2026-07-28T10:00:00Z",
  "cve_reference": "CVE-2026-XXXXX or null",
  "source_author": "Source Name"
}

Return ONLY valid JSON array, no markdown, no code blocks. Array should be wrapped as: [{"title": ..., ...}, ...]`
          }
        ],
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const content = response.data.choices[0].message.content;
    const newsItems = JSON.parse(content);

    cache.data = newsItems;
    cache.timestamp = Date.now();

    res.json(newsItems);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch news',
      message: error.message
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`AINews backend running on http://localhost:${PORT}`);
  console.log(`API endpoint: http://localhost:${PORT}/api/news`);
});
