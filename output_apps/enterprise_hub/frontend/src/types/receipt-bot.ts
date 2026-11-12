export interface GenerateLinkCodeResponse {
  code: string;
  expiresAt: string;
  botUsername: string | null;
  deepLink: string | null;
}

export interface ReceiptBotStatusResponse {
  linked: boolean;
  telegramUsername: string | null;
  defaultKind: 'petty_cash' | 'purchase';
  botConfigured: boolean;
  botUsername: string | null;
}

export interface UpdateReceiptBotPreferencesInput {
  defaultKind: 'petty_cash' | 'purchase';
}
