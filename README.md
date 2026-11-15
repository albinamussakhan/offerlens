# Offerlens

**Know where you stand before the interview.**

Offerlens is an AI-powered career preparation platform that helps job seekers understand how well their experience aligns with a specific opportunity, identify areas for improvement, and prepare through personalized interview practice. By connecting resume analysis with targeted questions and actionable feedback, Offerlens turns uncertainty into a clear preparation plan.

It is built for job seekers preparing for a specific application, especially people who have a CV and a vacancy in hand but no one to run a realistic practice interview with them.

**Live demo:** <https://offerlens-q53c.onrender.com/>

Built by **Team SheXtra** for Business Cup 2.0.

---

## The problem

Most interview preparation is generic. Lists of "common interview questions" don't know what *this* vacancy asks for or what *your* CV is missing, and real practice usually needs another person's time. Candidates often learn about their gaps only in the interview itself.

## The solution

Offerlens compares your CV with the vacancy and focuses on the gaps between them. Instead of a long questionnaire, it asks three targeted questions, two technical and one fundamental, and grades your answers against key points a strong answer should cover. The result is short, plain-language feedback you can act on the same day.

## How it works

1. **Add your documents (step 01).** Upload or paste your CV and the job vacancy. PDF, DOCX and TXT files are read directly in your browser.
2. **Answer three questions (steps 02–04).** Each question is tailored to the vacancy and your CV. Type your answer, or speak it in browsers that support speech recognition. Each step unlocks once the previous question is answered.
3. **Get your result.** You see:
   - an overall verdict (*likely to pass*, *close*, or *not ready yet*) with a readiness estimate
   - for each question: what you covered, what you missed, and a model answer
   - your strongest point and your biggest risk
   - four next steps, ordered by impact

## Features

- **CV and vacancy input:** upload PDF, DOCX, TXT or Markdown files, or paste text. Text is extracted in the browser, and you can edit it before analysis. A "Fill with an example" button loads a sample CV and vacancy.
- **Tailored questions:** an AI model compares the two documents, estimates how well the CV matches on paper, lists matched skills and gaps, and writes three questions (two technical, one fundamental).
- **Step-by-step interview:** one question per page with navigation between steps 01–04. Your answers are kept when you move between questions.
- **Optional voice input:** speak your answer instead of typing, using your browser's built-in speech recognition. Spoken text appears in the answer box and stays editable. See [Known limitations](#known-limitations).
- **Answer feedback:** each answer is graded against key points. The key points are shown only on the results page, after you have answered.
- **Results tools:** copy the report to the clipboard, go back and change your answers, or start over.
- **Clear validation:** documents (up to 30,000 characters) and answers (up to 20,000 characters) are checked, and anything over a limit gets a message naming the item and the limit. Nothing is silently cut.
- **No accounts and no storage:** nothing is saved on the server.

### How the readiness estimate is calculated

```
estimate = 30% × CV match score + 70% × average answer score   (limited to 5–95%)
```

The verdict follows the estimate: 70% or more is *likely to pass*, 45–69% is *close*, below 45% is *not ready yet*. The page labels this number "Estimated chance of an offer". It is a simple, transparent heuristic based on two documents and three written answers. **It is not a validated probability of receiving an offer.** Use it to decide what to practise.

## Technology

| Part | What it uses |
| --- | --- |
| Server | Node.js with Express 4 (ES modules) |
| AI | Anthropic Claude through the official `@anthropic-ai/sdk`: `claude-haiku-5-5` writes the questions, `claude-sonnet-5-5` grades the answers (both configurable) |
| Validation | Zod 4 for request validation and for checking the model's JSON output |
| Security | Helmet (Content Security Policy and other headers), `express-rate-limit` on the API |
| Document reading | PDF.js (`pdfjs-dist`) and Mammoth, both run in the browser |
| Frontend | Plain HTML, CSS and JavaScript, no build step; DM Sans font from Google Fonts |
| Voice input | The browser's Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) |
| Tests | Node's built-in test runner (`node:test`) |
| Delivery | GitHub Actions CI, a Dockerfile, hosted on Render |

## Run it locally

### Requirements

- **Node.js 22 or newer** (recommended). `package.json` allows Node 20, but CI and the Dockerfile use Node 22, and the PDF library declares Node 22.13 or newer.
- npm, which comes with Node.js.
- An Anthropic API key, only for real AI results. You can run the whole app without one in mock mode.

### Setup

1. **Get the code.** The GitHub repository is currently private, so cloning requires access from the repository owner.

   ```bash
   git clone https://github.com/albinamussakhan/offerlens.git
   cd offerlens
   ```

2. **Install dependencies.**

   ```bash
   npm install
   ```

3. **Create your local settings file.**

   ```bash
   cp .env.example .env              # macOS, Linux, Git Bash
   Copy-Item .env.example .env       # Windows PowerShell
   ```

4. **Add your Anthropic API key** (see [Configure Anthropic API access](#configure-anthropic-api-access)).

5. **Start the app.**

   ```bash
   npm start
   ```

   Open <http://localhost:3000>. The terminal also prints the active answer and document limits.

### Try it without an API key (mock mode)

```bash
npm run dev
```

This starts the app with canned AI responses and restarts it when you edit files. Mock mode is for trying the interface only: the questions are always the same sample questions, and answer scores depend on answer length, not content.

You can also set `MOCK_AI=1` in `.env` and run `npm start`.

## Configure Anthropic API access

1. Create an API key in the [Anthropic Console](https://console.anthropic.com/).
2. Open your local `.env` file and set:

   ```bash
   ANTHROPIC_API_KEY=your-key-here
   ```

3. Restart the app. To check the setup, open <http://localhost:3000/api/health>:
   - `"ai":"configured"`: a key is set and real analysis will run.
   - `"ai":"mock"`: mock mode is on.
   - `"ai":"missing"` (HTTP 503): no key and no mock mode. The page shows a "service is not reachable" notice.

Keep the key secret:

- `.env` is listed in `.gitignore`, so it is not committed. Never put a key in `.env.example`, the code or the README.
- The key is used only on the server. The browser never receives it.
- On a hosting service, add the key as an environment variable in the service's settings, not in the repository.
- Consider setting a monthly spend limit in the Anthropic Console.

### All settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | none | Required unless mock mode is on |
| `ANALYZE_MODEL` | `claude-haiku-5-5` | Model that reads the documents and writes the questions |
| `GRADE_MODEL` | `claude-sonnet-5-5` | Model that grades the answers |
| `PORT` | `3000` | Port the server listens on |
| `MAX_DOC_CHARS` | `30000` | Longest accepted CV or vacancy, in characters |
| `MAX_ANSWER_CHARS` | `20000` | Longest accepted answer, in characters |
| `AI_TIMEOUT_MS` | `120000` | Timeout for one AI request; retried at most once |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | `20` / `900000` (15 min) | API requests allowed per IP address per window |
| `TRUST_PROXY` | off | Proxy trust for the rate limiter: `1` trusts one reverse-proxy hop. Configure it for your hosting environment and verify it (see [Deployment](#deployment)) |
| `MOCK_AI` | off | `1` returns canned responses with no API calls |

## Run the tests

```bash
npm test
```

The suite uses Node's built-in test runner. It needs no API key and makes no paid calls: tests use mock mode or a small local stand-in for the Anthropic API. It covers:

- request validation and document and answer length limits
- the full analyze and grade flow, timeouts, retries and AI error handling
- parsing and validating the model's JSON
- prompt safety: user text cannot escape its delimiters
- the readiness score maths
- voice-input state handling
- that answer guidance is hidden until results
- security headers and static files

GitHub Actions runs the same tests on every push and pull request (`.github/workflows/ci.yml`).

## Project structure

```
offerlens/
├── public/                 Frontend (served as static files, no build step)
│   ├── index.html          Page layout: landing page, steps 01–04, results
│   ├── styles.css          All styles
│   ├── app.js              App logic: uploads, navigation, questions, results
│   └── voice.js            Optional voice-to-text (browser Web Speech API)
├── server/                 Backend (Node.js + Express)
│   ├── index.js            Starts the server
│   ├── app.js              Security headers, rate limit, static files, error handling
│   ├── config.js           Settings read from environment variables
│   ├── routes.js           API: POST /api/analyze, POST /api/grade, GET /api/health
│   ├── ai.js               Anthropic client, timeouts, retries, JSON parsing
│   ├── prompts.js          Prompts for analysis and grading
│   ├── schema.js           Input validation and checks on AI output
│   ├── scoring.js          Readiness estimate and verdict
│   └── mock.js             Canned responses for mock mode
├── test/                   Automated tests (node:test)
├── .github/workflows/      CI: runs the tests on GitHub
├── .env.example            Template for local settings (no secrets)
├── Dockerfile              Container image (Node 22)
└── package.json            Dependencies and npm scripts
```

### API summary

| Endpoint | Purpose |
| --- | --- |
| `POST /api/analyze` | Body `{ cv, jd }`. Returns the role, CV match score, matched skills, gaps and three questions with their key points |
| `POST /api/grade` | Body `{ analysis, answers: { Q1, Q2, Q3 } }`. Returns per-answer feedback, summary, next steps, the readiness estimate and the verdict |
| `GET /api/health` | Reports whether AI access is configured |

Errors are returned as JSON, for example `{ "error": "The CV is too long (30,001 characters; the limit is 30,000). Shorten it and try again." }`.

## Deployment

The live demo runs on Render. Any Node.js host should work:

- **Build command:** `npm ci`
- **Start command:** `npm start`
- **Environment variables:** at least `ANTHROPIC_API_KEY`
- **Health check path:** `/api/health`

**Proxy trust.** The rate limiter identifies visitors by IP address. If the app runs behind a reverse proxy, load balancer or CDN, configure proxy trust to match your hosting setup. `TRUST_PROXY=1` trusts exactly one proxy hop; leave it off when there is no proxy. Then verify it:

1. Request any API URL, for example `https://<your-host>/api/nope` (it returns 404 but includes rate-limit headers), from two different networks, such as a phone on mobile data and a laptop on Wi-Fi.
2. Compare the `RateLimit-Remaining` response headers. Separate counts mean visitors are identified correctly. A shared count means the server sees the proxy's address instead of the visitor's.

Don't trust more proxy hops than your setup actually has: that would let clients forge their IP address and bypass the rate limit.

With Docker:

```bash
docker build -t offerlens .
docker run -p 3000:3000 -e ANTHROPIC_API_KEY=your-key-here offerlens
```

## Privacy

- Your CV, the vacancy and your answers are sent to the Anthropic API to generate questions and feedback.
- Offerlens does not store them: there is no database, nothing is written to disk, and the server does not log document or answer text.
- Voice input runs in your browser. Offerlens never receives audio, but some browsers send audio to their own speech service (for example Google, Microsoft or Apple).

## Known limitations

- **The readiness estimate is a heuristic, not a validated probability of receiving an offer.** It is based only on two documents and three written answers. It doesn't know the other candidates or the employer's priorities.
- **AI output can be wrong.** Questions and feedback come from a language model and can be inaccurate or incomplete. The prompts tell the model not to invent experience, but this can't be guaranteed.
- **Voice input depends on the browser.** It works in Microsoft Edge on desktop. On Safari on iPad, recognition currently stops before any speech is transcribed. Firefox has no speech recognition. Typing always works.
- **English only.** Prompts and voice input are set up for English.
- **Scanned PDFs can't be read.** Image-only PDFs have no text layer; paste the text instead.
- **Size limits:** 30,000 characters per document and 20,000 per answer.
- **No saved sessions:** refreshing or closing the page loses your progress.
- **Rate limit:** by default, 20 API requests per 15 minutes per IP address (one full run uses two).

## Team

Offerlens was created by **Team SheXtra** for the Business Cup 2.0 hackathon.

## License

No license file is included yet, so no open-source license has been granted.
