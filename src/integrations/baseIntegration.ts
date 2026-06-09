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
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.json() as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.config.maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }
    throw lastError ?? new Error('Fetch failed');
  }

  abstract healthCheck(): Promise<boolean>;
}
