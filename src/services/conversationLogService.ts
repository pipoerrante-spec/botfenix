import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env';

export type ConversationChannel = 'whatsapp' | 'web' | 'operations';
export type ConversationDirection = 'incoming' | 'outgoing';

export interface ConversationLogEntry {
  conversationId: string;
  channel: ConversationChannel;
  direction: ConversationDirection;
  message: string;
  phone?: string;
  name?: string;
  metadata?: Record<string, unknown>;
}

let supabaseClient: SupabaseClient | null = null;

const resolveClient = (): SupabaseClient | null => {
  if (supabaseClient) {
    return supabaseClient;
  }

  if (env.supabase?.url && env.supabase?.serviceRoleKey) {
    supabaseClient = createClient(env.supabase.url, env.supabase.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  return supabaseClient;
};

export const logConversationMessage = async (entry: ConversationLogEntry): Promise<void> => {
  const client = resolveClient();
  if (!client) {
    return;
  }

  const payload = {
    conversation_id: entry.conversationId,
    channel: entry.channel,
    direction: entry.direction,
    phone: entry.phone ?? null,
    name: entry.name ?? null,
    message: entry.message,
    metadata: entry.metadata ?? null,
  };

  try {
    await client.from('conversation_logs').insert(payload);
  } catch (error) {
    console.error('Error logging conversation in Supabase', error);
  }
};
