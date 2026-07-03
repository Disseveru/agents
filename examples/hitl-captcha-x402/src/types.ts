export type CaptchaKind = "recaptcha" | "hcaptcha" | "turnstile" | "unknown";

export type CaptchaChallenge = {
  kind: CaptchaKind;
  siteKey: string | null;
  pageUrl: string;
  pageTitle: string;
  screenshotBase64: string | null;
  extra: {
    action?: string;
    theme?: string;
    size?: string;
    callbackName?: string;
  };
};

export type SessionStatus =
  | "starting"
  | "awaiting_human"
  | "injecting"
  | "solved"
  | "failed"
  | "expired";

export type SessionRecord = {
  id: string;
  status: SessionStatus;
  targetUrl: string;
  createdAt: number;
  updatedAt: number;
  challenge: CaptchaChallenge | null;
  error: string | null;
  result: AuthPayload | null;
};

export type AuthPayload = {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None" | undefined;
  }>;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  finalUrl: string;
  userAgent: string;
};

export type SolveCaptchaRequest = {
  url: string;
  wait?: boolean;
  callbackUrl?: string;
};

export type SolveCaptchaResponse = {
  sessionId: string;
  status: SessionStatus;
  solveUrl: string;
  challenge: CaptchaChallenge | null;
  result?: AuthPayload;
  error?: string;
};

export type SubmitTokenRequest = {
  token: string;
};

export type SessionStatusResponse = {
  sessionId: string;
  status: SessionStatus;
  challenge: CaptchaChallenge | null;
  result: AuthPayload | null;
  error: string | null;
};
