export interface WhatsAppTextMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | string;
  text?: {
    body: string;
  };
}

export interface WhatsAppContact {
  profile?: {
    name?: string;
  };
  wa_id: string;
}

export interface WhatsAppChangeValue {
  messaging_product?: 'whatsapp';
  contacts?: WhatsAppContact[];
  messages?: WhatsAppTextMessage[];
}

export interface WhatsAppChange {
  value?: WhatsAppChangeValue;
  field?: string;
}

export interface WhatsAppWebhookEntry {
  id?: string;
  changes?: WhatsAppChange[];
}

export interface WhatsAppWebhookRequestBody {
  object?: string;
  entry?: WhatsAppWebhookEntry[];
}
