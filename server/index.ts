import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: '2mb' }));

// Exchange Firebase refresh token for access token
app.post('/api/auth', async (req, res) => {
  const { refreshToken, googleApiKey } = req.body as {
    refreshToken: string;
    googleApiKey: string;
  };

  if (!refreshToken || !googleApiKey) {
    res.status(400).json({ error: 'Missing refreshToken or googleApiKey' });
    return;
  }

  try {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const { data } = await axios.post(
      `https://securetoken.googleapis.com/v1/token?key=${googleApiKey}`,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    res.json({ accessToken: data.access_token, userId: data.user_id });
  } catch {
    res.status(401).json({ error: 'Authentication failed. Check your credentials.' });
  }
});

// Proxy all Invintory API calls (forwards Authorization header)
app.use('/api/invintory', async (req: express.Request, res: express.Response) => {
  const targetUrl = `https://api.invintorywines.com/v2${req.url}`;

  try {
    const response = await axios({
      method: req.method,
      url: targetUrl,
      headers: {
        Authorization: req.headers.authorization ?? '',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      data: ['POST', 'PUT', 'PATCH'].includes(req.method) ? req.body : undefined,
      validateStatus: () => true,
    });
    res.status(response.status).json(response.data);
  } catch {
    res.status(502).json({ error: 'Invintory API unavailable' });
  }
});

// Claude-powered wine advisor
app.post('/api/advisor', async (req, res) => {
  const { question, collectionSummary } = req.body as {
    question: string;
    collectionSummary: string;
  };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured on the server.' });
    return;
  }

  if (!question) {
    res.status(400).json({ error: 'Missing question' });
    return;
  }

  const client = new Anthropic({ apiKey });

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: `You are a knowledgeable sommelier and wine advisor with access to a user's personal wine collection.
Answer questions about wine choices, food pairings, which bottles to open for occasions, aging potential, tasting notes, and general wine advice.
Be specific about wines in the collection when relevant. Keep responses concise and practical.
If the user asks about a wine not in their collection, still answer helpfully.`,
      messages: [
        {
          role: 'user',
          content: collectionSummary
            ? `Here is a summary of my wine collection:\n\n${collectionSummary}\n\n${question}`
            : question,
        },
      ],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    res.json({ answer: text });
  } catch {
    res.status(500).json({ error: 'Failed to get response from Claude. Check your API key.' });
  }
});

// Serve React build in production
if (process.env.NODE_ENV === 'production') {
  const distPath = path.resolve(__dirname, '../dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
