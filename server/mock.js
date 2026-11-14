// Canned responses so the app runs end to end without an API key (MOCK_AI=1).
// Grading scores follow answer length so the three verdicts can be demoed.

export function mockAnalysis() {
  return {
    role: "Senior Backend Engineer",
    company: "Altyn Fintech",
    seniority: "Senior",
    fitScore: 58,
    fitSummary: "Strong Python and PostgreSQL base. Missing Kafka, Kubernetes and senior-level ownership.",
    matched: ["Python", "FastAPI", "PostgreSQL", "Docker", "Idempotency"],
    gaps: ["Kafka", "Kubernetes", "Observability", "Mentoring"],
    questions: [
      {
        kind: "Technical",
        question: "A payment request times out and the client retries. How do you make sure the customer is charged once?",
        topic: "Idempotent payments",
        why: "The role owns payment services, and your CV mentions idempotency keys.",
        passPoints: [
          "Use a unique idempotency key per request",
          "Store the key and result atomically",
          "Return the saved result on a retry",
          "Handle concurrent duplicate requests",
        ],
      },
      {
        kind: "Technical",
        question: "How would you move nightly settlement from Celery jobs to an event-driven design with Kafka?",
        topic: "Kafka event design",
        why: "The vacancy requires Kafka, which your CV does not show.",
        passPoints: [
          "Define events and topics clearly",
          "Choose a partition key for ordering",
          "Make consumers idempotent",
          "Plan retries and a dead-letter topic",
        ],
      },
      {
        kind: "Fundamental",
        question: "Two services update the same account balance at the same time. What can go wrong and how do you prevent it?",
        topic: "Concurrency and consistency",
        why: "Consistency is a core principle behind any payments system.",
        passPoints: [
          "Name the race condition or lost update",
          "Use transactions or row locks",
          "Consider optimistic locking with versions",
          "Mention a ledger with append-only entries",
        ],
      },
    ],
  };
}

export function mockGrade(answers) {
  const score = (text) => Math.max(10, Math.min(92, Math.round(String(text).trim().length / 3)));
  return {
    answers: ["Q1", "Q2", "Q3"].map((id) => {
      const s = score(answers[id]);
      return {
        id,
        score: s,
        covered: s >= 40 ? ["Explained the main idea clearly"] : [],
        missed: s >= 70 ? [] : ["Did not cover concurrent duplicate requests", "No mention of failure handling"],
        sayItLike:
          "Use a unique key for every request and save the result with it. If the same key arrives again, return the saved result instead of charging twice.",
      };
    }),
    summary:
      "Your base is solid, but the answers miss some senior-level detail. Adding specifics about failure handling would raise your chances.",
    strongest: "Real production experience with payment reconciliation and idempotency keys.",
    risk: "No hands-on Kafka or Kubernetes experience, which the vacancy lists as requirements.",
    nextSteps: [
      { action: "Build a small Kafka consumer with retries and a dead-letter topic", why: "It closes your biggest gap against the vacancy.", when: "This week" },
      { action: "Add the 40k transactions per day figure to your CV summary", why: "Scale numbers show senior-level scope.", when: "Before you apply" },
      { action: "Practice explaining idempotency out loud in under two minutes", why: "Clear spoken answers matter in the interview.", when: "Today" },
      { action: "Read one incident review and note how on-call is run", why: "The role owns reliability and on-call.", when: "This week" },
    ],
  };
}
