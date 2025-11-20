"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveLeadSession = exports.findLeadSession = exports.ensureLeadSession = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const env_1 = require("../config/env");
const TABLE_NAME = 'lead_sessions';
const inMemorySessions = new Map();
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
const materializeSession = (normalizedWaId, waId, snapshot) => {
    return {
        waId,
        normalizedWaId,
        stage: snapshot.stage,
        history: snapshot.history ?? [],
        name: snapshot.name,
        nameConfirmed: snapshot.nameConfirmed,
        city: snapshot.city,
        cityAllowed: snapshot.cityAllowed,
        cityNoticeSent: snapshot.cityNoticeSent,
        interests: snapshot.interests ?? [],
        pendingFields: snapshot.pendingFields ?? [],
        order: snapshot.order,
        mediaShared: snapshot.mediaShared ?? false,
        introducedProduct: snapshot.introducedProduct ?? false,
    };
};
const loadPersistedSession = async (normalizedWaId) => {
    const client = resolveClient();
    if (!client) {
        return null;
    }
    try {
        const { data, error } = await client
            .from(TABLE_NAME)
            .select('wa_id, session_data')
            .eq('conversation_id', normalizedWaId)
            .maybeSingle();
        if (error) {
            console.error('Error fetching lead session from Supabase', error);
            return null;
        }
        const row = data;
        if (!row?.session_data) {
            return null;
        }
        return materializeSession(normalizedWaId, row.wa_id ?? normalizedWaId, row.session_data);
    }
    catch (error) {
        console.error('Unexpected error fetching lead session from Supabase', error);
        return null;
    }
};
const cacheSession = (session) => {
    inMemorySessions.set(session.normalizedWaId, session);
    return session;
};
const buildSnapshot = (session) => {
    return {
        stage: session.stage,
        history: session.history,
        name: session.name,
        nameConfirmed: session.nameConfirmed,
        city: session.city,
        cityAllowed: session.cityAllowed,
        cityNoticeSent: session.cityNoticeSent,
        interests: session.interests ?? [],
        pendingFields: session.pendingFields,
        order: session.order,
        mediaShared: session.mediaShared ?? false,
        introducedProduct: session.introducedProduct ?? false,
    };
};
const ensureLeadSession = async (params) => {
    const { waId, normalizedWaId, profileName } = params;
    let session = inMemorySessions.get(normalizedWaId);
    if (!session) {
        const persisted = await loadPersistedSession(normalizedWaId);
        if (persisted) {
            session = cacheSession(persisted);
        }
    }
    if (!session) {
        session = {
            waId,
            normalizedWaId,
            stage: 'nuevo',
            history: [],
            name: profileName,
            nameConfirmed: false,
            pendingFields: [],
            mediaShared: false,
            introducedProduct: false,
        };
        cacheSession(session);
    }
    else {
        session.waId = waId;
        if (profileName && !session.name) {
            session.name = profileName;
        }
    }
    return session;
};
exports.ensureLeadSession = ensureLeadSession;
const findLeadSession = async (normalizedWaId) => {
    const cached = inMemorySessions.get(normalizedWaId);
    if (cached) {
        return cached;
    }
    const persisted = await loadPersistedSession(normalizedWaId);
    if (persisted) {
        return cacheSession(persisted);
    }
    return null;
};
exports.findLeadSession = findLeadSession;
const saveLeadSession = async (session) => {
    cacheSession(session);
    const client = resolveClient();
    if (!client) {
        return;
    }
    try {
        const snapshot = buildSnapshot(session);
        const { error } = await client.from(TABLE_NAME).upsert({
            conversation_id: session.normalizedWaId,
            wa_id: session.waId,
            session_data: snapshot,
        });
        if (error) {
            console.error('Error saving lead session to Supabase', error);
        }
    }
    catch (error) {
        console.error('Unexpected error saving lead session to Supabase', error);
    }
};
exports.saveLeadSession = saveLeadSession;
