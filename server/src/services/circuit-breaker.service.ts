export class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";

  constructor(
    private readonly threshold = 5,
    private readonly timeoutMs = 60_000,
    private readonly name = "external"
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailure > this.timeoutMs) {
        this.state = "HALF_OPEN";
      } else {
        throw new Error(`Circuit OPEN for ${this.name} — aguardando recuperação`);
      }
    }
    try {
      const result = await fn();
      if (this.state === "HALF_OPEN") this.reset();
      return result;
    } catch (e) {
      this.failures++;
      this.lastFailure = Date.now();
      if (this.failures >= this.threshold) this.state = "OPEN";
      throw e;
    }
  }

  private reset() { this.failures = 0; this.state = "CLOSED"; }
  get status() { return { state: this.state, failures: this.failures }; }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1000
): Promise<T> {
  let lastError: unknown;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (i < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, i - 1) + Math.random() * 500;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

// Singleton para OpenAI
export const openAiBreaker = new CircuitBreaker(5, 60_000, "OpenAI");
