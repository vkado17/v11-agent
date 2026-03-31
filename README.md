# V11 Dinner Invite Agent

Exa → Fullenrich → Claude → Gmail Drafts

## Setup (3 steps)

**1. Install dependencies**
```bash
npm install
```

**2. Add your API keys**
```bash
cp .env.local.example .env.local
```
Then edit `.env.local`:
```
EXA_API_KEY=your_exa_key
FULLENRICH_API_KEY=your_fullenrich_key
ANTHROPIC_API_KEY=your_anthropic_key
```

**3. Run**
```bash
npm run dev
```
Open http://localhost:3000

## Deploy to Vercel (optional)
```bash
npx vercel
```
Add your env vars in the Vercel dashboard under Project → Settings → Environment Variables.

## Notes
- Gmail drafts use Anthropic's Gmail MCP — you need to be logged into claude.ai in the same browser session
- Fullenrich endpoint: `POST https://api.fullenrich.com/v1/enrich` with `{ linkedin_url: "..." }`
  If your Fullenrich plan uses a different endpoint, edit `pages/api/fullenrich.js`
