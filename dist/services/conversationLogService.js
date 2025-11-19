"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logConversationMessage = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const env_1 = require("../config/env");
let supabaseClient = null;
const resolveClient = () => {
    if (supabaseClient) {
        return supabaseClient;
    }
    if (env_1.env.supabase?.url && env_1.env.supabase?.serviceRoleKey) {
        supabaseClient = (0, supabase_js_1.createClient)(env_1.env.supabase.url, env_1.env.supabase.serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false },
        });
    }
    return supabaseClient;
};
const logConversationMessage = async (entry) => {
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
    }
    catch (error) {
        console.error('Error logging conversation in Supabase', error);
    }
};
exports.logConversationMessage = logConversationMessage;
