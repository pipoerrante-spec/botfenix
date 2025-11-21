import fs from 'fs';
import path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
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

interface StoredLogRow {
  id: string;
  conversation_id: string;
  channel: ConversationChannel;
  direction: ConversationDirection;
  phone?: string | null;
  name?: string | null;
  message: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}

const LOCAL_LOG_LIMIT = 1000;
const localLogPath = path.join(process.cwd(), 'data', 'conversationLogs.json');

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

const readLocalLogs = (): StoredLogRow[] => {
  try {
    if (!fs.existsSync(localLogPath)) {
      return [];
    }
    const raw = fs.readFileSync(localLogPath, 'utf-8');
    const parsed = JSON.parse(raw) as StoredLogRow[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch (error) {
    console.error('No se pudo leer conversationLogs.json', error);
    return [];
  }
};

const persistLocalLogs = async (rows: StoredLogRow[]): Promise<void> => {
  await fs.promises.mkdir(path.dirname(localLogPath), { recursive: true });
  await fs.promises.writeFile(localLogPath, JSON.stringify(rows, null, 2), 'utf-8');
};

const appendLocalLog = async (row: StoredLogRow): Promise<void> => {
  const logs = readLocalLogs();
  logs.unshift(row);
  if (logs.length > LOCAL_LOG_LIMIT) {
    logs.length = LOCAL_LOG_LIMIT;
  }
  await persistLocalLogs(logs);
};

export const getLocalConversationLogs = (limit = 50): StoredLogRow[] => {
  const logs = readLocalLogs();
  return logs.slice(0, limit);
};

export const getLocalConversationStats = (): {
  total: number;
  byChannel: Record<string, number>;
  byDirection: Record<string, number>;
} => {
  const logs = readLocalLogs();
  const byChannel: Record<string, number> = {};
  const byDirection: Record<string, number> = {};
  logs.forEach((log) => {
    byChannel[log.channel] = (byChannel[log.channel] ?? 0) + 1;
    byDirection[log.direction] = (byDirection[log.direction] ?? 0) + 1;
  });
  return {
    total: logs.length,
    byChannel,
    byDirection,
  };
};

export const logConversationMessage = async (entry: ConversationLogEntry): Promise<void> => {
  const payload: StoredLogRow = {
    id: randomUUID(),
    conversation_id: entry.conversationId,
    channel: entry.channel,
    direction: entry.direction,
    phone: entry.phone ?? null,
    name: entry.name ?? null,
    message: entry.message,
    metadata: entry.metadata ?? null,
    created_at: new Date().toISOString(),
  };

  const client = resolveClient();
  if (client) {
    try {
      await client.from('conversation_logs').insert(payload);
    } catch (error) {
      console.error('Error logging conversation in Supabase', error);
    }
  }

  try {
    await appendLocalLog(payload);
  } catch (error) {
    console.error('No se pudo guardar el log localmente', error);
  }
};
