export type LeadStage =
  | 'nuevo'
  | 'awaiting_name'
  | 'awaiting_city'
  | 'chatting'
  | 'collecting_order'
  | 'awaiting_confirmation'
  | 'pending_ops'
  | 'scheduled'
  | 'delivered';

export type OrderField = 'quantity' | 'deliveryTime' | 'address';

export interface OrderDraft {
  productName: string;
  price: number;
  currency: string;
  quantity?: number;
  requestedTime?: string;
  confirmedSlot?: string;
  address?: string;
  status: 'collecting' | 'pending_ops' | 'scheduled' | 'delivered';
}

export interface LeadSession {
  waId: string;
  normalizedWaId: string;
  stage: LeadStage;
  history: string[];
  name?: string;
  city?: string;
  cityAllowed?: boolean;
  interests?: string[];
  pendingFields: OrderField[];
  order?: OrderDraft;
  mediaShared?: boolean;
}
