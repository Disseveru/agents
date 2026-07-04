interface Env {
  MYBROWSER: Fetcher;
  CAPTCHA_SESSION: DurableObjectNamespace;
  SERVER_ADDRESS?: string;
  NTFY_TOPIC: string;
  X402_NETWORK: string;
  X402_PRICE: string;
  SESSION_TTL_SECONDS: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
}
