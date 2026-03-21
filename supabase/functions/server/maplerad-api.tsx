/**
 * BorderPay Africa - Maplerad API Client (Slim)
 * Only includes methods used by the Hono server (non-financial).
 * All financial operations go through standalone Edge Functions.
 */

export interface MapleradConfig {
  secretKey: string;
  baseUrl?: string;
}

export class MapleradAPI {
  private secretKey: string;
  private baseUrl: string;

  constructor(config: MapleradConfig) {
    this.secretKey = config.secretKey;
    this.baseUrl = config.baseUrl || 'https://api.maplerad.com/v1';
  }

  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    body?: any
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.secretKey}`,
      'Content-Type': 'application/json',
    };
    const options: RequestInit = { method, headers };
    if (body && (method === 'POST' || method === 'PUT')) {
      options.body = JSON.stringify(body);
    }
    try {
      console.log(`[Maplerad] ${method} ${endpoint}`);
      const response = await fetch(url, options);
      const data = await response.json();
      if (!response.ok) {
        console.error('[Maplerad] API Error:', data);
        throw new Error(data.message || `Maplerad API error: ${response.status}`);
      }
      return data;
    } catch (error) {
      console.error(`[Maplerad] Request failed:`, error);
      throw error;
    }
  }

  /** Create a customer (Tier 0) */
  async createCustomer(data: {
    first_name: string;
    last_name: string;
    email: string;
    country: string;
  }): Promise<any> {
    return this.request('/customers', 'POST', data);
  }
}

/** Create Maplerad API client instance */
export function createMapleradClient(config?: Partial<MapleradConfig>): MapleradAPI {
  const secretKey = config?.secretKey || Deno.env.get('MAPLERAD_SECRET_KEY');
  if (!secretKey) {
    throw new Error('MAPLERAD_SECRET_KEY is required');
  }
  return new MapleradAPI({ secretKey, baseUrl: config?.baseUrl });
}
