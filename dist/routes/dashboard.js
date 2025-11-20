"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const env_1 = require("../config/env");
const supabase_js_1 = require("@supabase/supabase-js");
const router = (0, express_1.Router)();
const requireSupabase = () => {
    if (!env_1.env.supabase?.url || !env_1.env.supabase?.serviceRoleKey) {
        throw new Error('Supabase no está configurado');
    }
    return (0, supabase_js_1.createClient)(env_1.env.supabase.url, env_1.env.supabase.serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
};
router.get('/logs', async (req, res) => {
    try {
        const client = requireSupabase();
        const limit = Math.min(Number(req.query.limit) || 50, 500);
        const { data, error } = await client
            .from('conversation_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);
        if (error) {
            throw error;
        }
        return res.json(data);
    }
    catch (error) {
        console.error('Error cargando logs', error);
        return res.status(500).json({ error: 'No se pudieron cargar los logs' });
    }
});
router.get('/stats', async (_req, res) => {
    try {
        const client = requireSupabase();
        const [totalRes, breakdownRes] = await Promise.all([
            client.from('conversation_logs').select('*', { count: 'exact', head: true }),
            client.from('conversation_logs').select('channel, direction').limit(1000),
        ]);
        const byChannel = {};
        const byDirection = {};
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
    }
    catch (error) {
        console.error('Error cargando stats', error);
        return res.status(500).json({ error: 'No se pudieron cargar las estadísticas' });
    }
});
exports.default = router;
