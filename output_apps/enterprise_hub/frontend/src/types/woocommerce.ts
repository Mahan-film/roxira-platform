export interface WooCommerceConfig {
  storeUrl: string;
  maskedConsumerKey: string;
  hasConsumerSecret: boolean;
  webhookSecret: string;
  webhookUrl: string;
  autoSyncOrders: boolean;
  autoSyncStock: boolean;
  lastSyncAt: string | null;
  updatedAt: string;
}

export interface UpdateWooCommerceConfigInput {
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
  webhookSecret?: string;
  autoSyncOrders?: boolean;
  autoSyncStock?: boolean;
}

export interface WooCommerceSyncLog {
  id: string;
  tenantId: string;
  direction: 'inbound_order' | 'outbound_stock' | 'outbound_price';
  status: 'success' | 'failed' | 'skipped';
  externalId: string;
  internalId: string | null;
  payloadSummary: Record<string, any>;
  errorMessage: string | null;
  createdAt: string;
}
