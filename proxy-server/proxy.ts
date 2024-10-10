import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import fetch from 'node-fetch';

dotenv.config();

const app = express();
const PORT = process.env.PROXY_PORT || 8080;

// Set CORS headers to allow requests from your frontend
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept',
  );
  next();
});

app.get('/proxy', async (req: Request, res: Response) => {
  const query = req.query.q as string;
  if (!query) {
    return res.status(400).send('Query parameter "q" is required');
  }

  try {
    const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`;
    const headers = {
      'Accept-Language': 'de-DE,en-US,en;q=0.5',
    };
    const response = await fetch(apiUrl, {
      headers,
    });
    const data = await response.json();
    res.json(data);

    console.log({ query, apiUrl, headers, data, v: '4' });
  } catch (error) {
    console.error('Error fetching data from DuckDuckGo:', error);
    res.status(500).send('Error fetching data from DuckDuckGo');
  }
});

// General proxy endpoint for scraping web pages
app.get('/scrape', async (req: Request, res: Response) => {
  const url = req.query.url as string;
  if (!url) {
    return res.status(400).send('Query parameter "url" is required');
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch webpage: ${response.statusText}`);
    }
    const html = await response.text();
    console.log({ html });
    res.send(html);
  } catch (error) {
    console.error('Error scraping webpage:', error);
    res.status(500).send('Error scraping webpage');
  }
});

app.listen(PORT, () => {
  console.log(`Proxy server is running at http://localhost:${PORT}`);
});
