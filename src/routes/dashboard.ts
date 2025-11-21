import { Router, Request, Response } from 'express';
import { env } from '../config/env';
import { createClient } from '@supabase/supabase-js';
import { getLocalConversationLogs, getLocalConversationStats } from '../services/conversationLogService';

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

export default router;
