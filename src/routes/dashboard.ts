import { Router, Request, Response } from 'express';
import { env } from '../config/env';
import { createClient } from '@supabase/supabase-js';
import {
  getLocalConversationLogs,
  getLocalConversationStats,
  StoredLogRow,
} from '../services/conversationLogService';

const router = Router();

const hasSupabase = (): boolean => Boolean(env.supabase?.url && env.supabase?.serviceRoleKey);

const requireSupabase = () => {
  if (!hasSupabase()) {
    throw new Error('Supabase no está configurado');
  }
  return createClient(env.supabase!.url, env.supabase!.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
};

type FunnelStage = 'descubrimiento' | 'negociacion' | 'coordinacion' | 'ganada';
type LogisticsState = 'por_asignar' | 'en_gestion' | 'en_transito' | 'entregado';

interface ConversationSummary {
  conversationId: string;
  funnelStage: FunnelStage;
  logisticsState: LogisticsState;
  lastMessage: string;
  lastDirection: string;
  lastChannel: string;
  lastActivity: string;
  totalMessages: number;
  name?: string | null;
  phone?: string | null;
}

const mapStageToFunnel = (stage?: string): FunnelStage => {
  if (!stage) return 'descubrimiento';
  switch (stage) {
    case 'collecting_order':
    case 'awaiting_confirmation':
      return 'negociacion';
    case 'pending_ops':
    case 'scheduled':
      return 'coordinacion';
    case 'delivered':
      return 'ganada';
    default:
      return 'descubrimiento';
  }
};

const mapStageToLogistics = (stage?: string): LogisticsState => {
  switch (stage) {
    case 'pending_ops':
      return 'en_gestion';
    case 'scheduled':
      return 'en_transito';
    case 'delivered':
      return 'entregado';
    default:
      return 'por_asignar';
  }
};

const buildConversationSummaries = (logs: StoredLogRow[]): ConversationSummary[] => {
  const map = new Map<string, ConversationSummary & { lastDate: number }>();

  logs.forEach((log) => {
    const timestamp = new Date(log.created_at).getTime();
    const stage = typeof log.metadata?.stage === 'string' ? (log.metadata.stage as string) : undefined;
    const existing = map.get(log.conversation_id);
    if (!existing) {
      map.set(log.conversation_id, {
        conversationId: log.conversation_id,
        funnelStage: mapStageToFunnel(stage),
        logisticsState: mapStageToLogistics(stage),
        lastMessage: log.message,
        lastDirection: log.direction,
        lastChannel: log.channel,
        lastActivity: log.created_at,
        totalMessages: 1,
        name: log.name ?? undefined,
        phone: log.phone ?? undefined,
        lastDate: timestamp,
      });
    } else {
      existing.totalMessages += 1;
      if (timestamp > existing.lastDate) {
        existing.lastDate = timestamp;
        existing.lastMessage = log.message;
        existing.lastDirection = log.direction;
        existing.lastChannel = log.channel;
        existing.lastActivity = log.created_at;
        existing.name = log.name ?? existing.name;
        existing.phone = log.phone ?? existing.phone;
      }
      const funnelCandidate = mapStageToFunnel(stage);
      const logisticsCandidate = mapStageToLogistics(stage);
      existing.funnelStage = funnelCandidate === 'descubrimiento' ? existing.funnelStage : funnelCandidate;
      existing.logisticsState = logisticsCandidate === 'por_asignar' ? existing.logisticsState : logisticsCandidate;
    }
  });

  return Array.from(map.values())
    .sort((a, b) => b.lastDate - a.lastDate)
    .map(({ lastDate, ...rest }) => rest);
};

router.get('/logs', async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  if (!hasSupabase()) {
    const localLogs = getLocalConversationLogs(limit);
    return res.json(localLogs);
  }

  try {
    const client = requireSupabase();
    const { data, error } = await client
      .from('conversation_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      throw error;
    }
    return res.json(data);
  } catch (error) {
    console.error('Error cargando logs', error);
    const localLogs = getLocalConversationLogs(limit);
    if (localLogs.length) {
      return res.json(localLogs);
    }
    return res.status(500).json({ error: 'No se pudieron cargar los logs' });
  }
});

router.get('/stats', async (_req: Request, res: Response) => {
  if (!hasSupabase()) {
    return res.json(getLocalConversationStats());
  }

  try {
    const client = requireSupabase();

    const [totalRes, breakdownRes] = await Promise.all([
      client.from('conversation_logs').select('*', { count: 'exact', head: true }),
      client.from('conversation_logs').select('channel, direction').limit(1000),
    ]);

    const byChannel: Record<string, number> = {};
    const byDirection: Record<string, number> = {};
    (breakdownRes.data ?? []).forEach((row) => {
      if (row.channel) {
        byChannel[row.channel] = (byChannel[row.channel] ?? 0) + 1;
      }
      if (row.direction) {
        byDirection[row.direction] = (byDirection[row.direction] ?? 0) + 1;
      }
    });

    return res.json({
      total: totalRes.count ?? 0,
      byChannel,
      byDirection,
    });
  } catch (error) {
    console.error('Error cargando stats', error);
    return res.json(getLocalConversationStats());
  }
});

router.get('/conversations', async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const channelFilter = typeof req.query.channel === 'string' ? req.query.channel : undefined;
  const funnelFilter = typeof req.query.funnel === 'string' ? req.query.funnel : undefined;

  const processLogs = (rows: StoredLogRow[]) => {
    let logs = rows;
    if (channelFilter && channelFilter !== 'all') {
      logs = logs.filter((log) => log.channel === channelFilter);
    }
    const summaries = buildConversationSummaries(logs);
    const filtered = funnelFilter && funnelFilter !== 'all'
      ? summaries.filter((summary) => summary.funnelStage === funnelFilter)
      : summaries;
    return filtered.slice(0, limit);
  };

  if (!hasSupabase()) {
    const local = getLocalConversationLogs(1000);
    return res.json(processLogs(local));
  }

  try {
    const client = requireSupabase();
    const { data, error } = await client
      .from('conversation_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error || !data) {
      throw error ?? new Error('Sin datos');
    }
    return res.json(processLogs(data as StoredLogRow[]));
  } catch (error) {
    console.error('Error cargando conversaciones', error);
    const local = getLocalConversationLogs(1000);
    return res.json(processLogs(local));
  }
});

export default router;
