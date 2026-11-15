# Offerlens

Upload a CV and a vacancy, answer the 3 questions that matter most for that role, and get a plain-language verdict (likely pass, close, or not ready) with next steps.

- **Step 01:** add the CV and the vacancy (PDF, DOCX, TXT, or pasted text).
- **Steps 02 to 04:** one tailored question per page. A step stays locked until the one before it is answered.
- **Result:** verdict, estimated chance of an offer, what you covered and missed on each answer, a model answer, and four next steps.

The chance is `30% CV match + 70% average answer score`, clamped to 5 to 95. It is an estimate from two documents and three answers, not a prediction.

## Run it

Requires Node 20 or newer.

```bash
npm install
cp .env.example .env      # add your ANTHROPIC_API_KEY
npm start                 # http://localhost:3000
```

No API key yet? Run the whole app with canned responses:

```bash
npm run dev               # mock mode, restarts on file changes (works on Windows too)
```

## Project layout

```
public/            Frontend: index.html, styles.css, app.js (no build step)
server/
  index.js         Starts the server
  app.js           Express app: security headers, rate limit, static files, error handler
  routes.js        POST /api/analyze, POST /api/grade, GET /api/health
  prompts.js       Prompt builders (candidate text is fenced as untrusted data)
  ai.js            Anthropic client, JSON extraction, one retry, mock switch
  schema.js        Request validation and defensive normalizing of model output
  scoring.js       Chance and verdict maths (unit tested)
  mock.js          Canned responses for MOCK_AI=1
test/              node:test unit and API tests (no network needed)
```

## API

`POST /api/analyze` with `{ "cv": string, "jd": string }` returns `{ analysis }`: role, CV match score, matched skills, gaps, and exactly 3 questions (2 technical, 1 fundamental), each with the key points a passing answer needs. The CV and vacancy must each be 150 to `MAX_DOC_CHARS` characters; a longer document gets a 400 naming it and the limit, and accepted documents are sent to the model in full.

`POST /api/grade` with `{ "analysis": <from analyze>, "answers": { "Q1", "Q2", "Q3" } }` returns `{ result }`: per-answer score, covered and missed points, a model answer, a summary, strongest point, biggest risk, four next steps, plus `chance` and `verdict` computed on the server. Each answer must be 30 to `MAX_ANSWER_CHARS` characters; an answer over the limit gets a 400 naming the question and the limit, and accepted answers are sent to the grader in full.

`GET /api/health` returns `{ ok, mock, ai }`, where `ai` is `"configured"`, `"mock"` or `"missing"`. It answers 503 when no API key is set and mock mode is off, so the page shows its "service is not reachable" notice.

Errors are JSON: `{ "error": "message for the user" }`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | none | Required unless `MOCK_AI=1` |
| `ANALYZE_MODEL` | `claude-haiku-5-5` | Fast model that writes the 3 questions |
| `GRADE_MODEL` | `claude-sonnet-5-5` | Stronger model that grades the answers |
| `PORT` | `3000` | |
| `MAX_DOC_CHARS` | `30000` | Longest accepted CV or vacancy, in characters. Longer documents are rejected with a message naming the document; accepted documents are analyzed in full |
| `MAX_ANSWER_CHARS` | `20000` | Longest accepted answer, in characters. Longer answers are rejected with a message naming the question; accepted answers are graded in full |
| `AI_TIMEOUT_MS` | `120000` | Timeout for one Anthropic request; the SDK retries at most once |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | `20` / 15 min | Per-IP limit on `/api` |
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy so the limit uses the real client IP |
| `MOCK_AI` | off | `1` returns canned responses |

## Test

```bash
npm test
```

Covers the scoring maths, JSON extraction, request validation, the full analyze and grade flow in mock mode, security headers, and static files.

## Deploy

Any Node host works (Render, Railway, Fly.io). Set `ANTHROPIC_API_KEY` and `TRUST_PROXY=1`, build command `npm ci`, start command `npm start`.

With Docker:

```bash
docker build -t offerlens .
docker run -p 3000:3000 -e ANTHROPIC_API_KEY=sk-... -e TRUST_PROXY=1 offerlens
```

## Privacy and safety notes

- CVs, vacancies and answers are sent to the Anthropic API for analysis. Nothing is written to disk or a database, and the server does not log document text.
- Text inside the CV and vacancy is fenced in tags and the model is told to treat it as data, which reduces prompt injection from hidden instructions. It does not remove the risk completely.
- The page sets a strict Content Security Policy. PDF.js and Mammoth are served from `node_modules`, so there are no third-party scripts. Fonts come from Google Fonts.
- Scanned PDFs have no text layer and cannot be read. The page asks the user to paste the text instead.
- Add a licence file before making the repository public.

## Push to GitHub

```bash
git init -b main
git add .
git commit -m "Initial commit"
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main
```

`.env` and `node_modules` are in `.gitignore`. The CI workflow in `.github/workflows/ci.yml` runs the tests on every push and pull request.
