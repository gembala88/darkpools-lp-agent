export interface IntegrationConfig {
  apiKey?: string;
  baseUrl: string;
  timeout: number;
  maxRetries: number;
  rateLimit: number;
}

export interface IntegrationAdapter {
  readonly name: string;
  healthCheck(): Promise<boolean>;
}

export abstract class BaseIntegration implements IntegrationAdapter {
  abstract readonly name: string;
  protected config: IntegrationConfig;
  private lastRequestTime = 0;

  constructor(config: Partial<IntegrationConfig> & { baseUrl: string }) {
    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      timeout: config.timeout ?? 10000,
      maxRetries: config.maxRetries ?? 3,
      rateLimit: config.rateLimit ?? 1000,
    };
  }

  protected async apiFetch<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    // Enforce minimum interval between requests
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.config.rateLimit) {
      await new Promise(resolve => setTimeout(resolve, this.config.rateLimit - elapsed));
    }

    const url = new URL(endpoint, this.config.baseUrl);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value != null) url.searchParams.set(key, String(value));
      });
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['x-api-key'] = this.config.apiKey;
    }
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
        const response = await fetch(url.toString(), { headers, signal: controller.signal });
        clearTimeout(timeoutId);
        this.lastRequestTime = Date.now();

        // 429 Rate limited — backoff with jitter, respect Retry-After header
        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after');
          const wait = retryAfter
            ? parseInt(retryAfter) * 1000 + Math.random() * 500
            : Math.pow(2, attempt) * 2000 + Math.random() * 1000;
          if (attempt < this.config.maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, wait));
            continue;
          }
          throw new Error(`HTTP 429: Rate limited after ${this.config.maxRetries} retries`);
        }

        // 401 Unauthorized — no point retrying
        if (response.status === 401) {
          throw new Error(`HTTP 401: Unauthorized - check API key for ${this.name}`);
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.json() as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        // Don't retry 401
        if (lastError.message?.includes('401')) throw lastError;
        if (attempt < this.config.maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }
    throw lastError ?? new Error('Fetch failed');
  }

  abstract healthCheck(): Promise<boolean>;
}
