"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logConversationMessage = exports.getLocalConversationStats = exports.getLocalConversationLogs = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const supabase_js_1 = require("@supabase/supabase-js");
const crypto_1 = require("crypto");
const env_1 = require("../config/env");
const LOCAL_LOG_LIMIT = 1000;
const localLogPath = path_1.default.join(process.cwd(), 'data', 'conversationLogs.json');
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
const readLocalLogs = () => {
    try {
        if (!fs_1.default.existsSync(localLogPath)) {
            return [];
        }
        const raw = fs_1.default.readFileSync(localLogPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed;
    }
    catch (error) {
        console.error('No se pudo leer conversationLogs.json', error);
        return [];
    }
};
const persistLocalLogs = async (rows) => {
    await fs_1.default.promises.mkdir(path_1.default.dirname(localLogPath), { recursive: true });
    await fs_1.default.promises.writeFile(localLogPath, JSON.stringify(rows, null, 2), 'utf-8');
};
const appendLocalLog = async (row) => {
    const logs = readLocalLogs();
    logs.unshift(row);
    if (logs.length > LOCAL_LOG_LIMIT) {
        logs.length = LOCAL_LOG_LIMIT;
    }
    await persistLocalLogs(logs);
};
const getLocalConversationLogs = (limit = 50) => {
    const logs = readLocalLogs();
    return logs.slice(0, limit);
};
exports.getLocalConversationLogs = getLocalConversationLogs;
const getLocalConversationStats = () => {
    const logs = readLocalLogs();
    const byChannel = {};
    const byDirection = {};
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
exports.getLocalConversationStats = getLocalConversationStats;
const logConversationMessage = async (entry) => {
    const payload = {
        id: (0, crypto_1.randomUUID)(),
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
        }
        catch (error) {
            console.error('Error logging conversation in Supabase', error);
        }
    }
    try {
        await appendLocalLog(payload);
    }
    catch (error) {
        console.error('No se pudo guardar el log localmente', error);
    }
};
exports.logConversationMessage = logConversationMessage;
