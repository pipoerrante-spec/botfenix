import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env';
import { LeadSession } from '../types/leadSession';

type LeadSessionSnapshot = Omit<LeadSession, 'waId' | 'normalizedWaId'>;

interface LeadSessionRow {
  conversation_id: string;
  wa_id?: string | null;
  session_data?: LeadSessionSnapshot | null;
}

const TABLE_NAME = 'lead_sessions';

const inMemorySessions = new Map<string, LeadSession>();
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

const materializeSession = (normalizedWaId: string, waId: string, snapshot: LeadSessionSnapshot): LeadSession => {
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

const loadPersistedSession = async (normalizedWaId: string): Promise<LeadSession | null> => {
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

    const row = data as LeadSessionRow | null;
    if (!row?.session_data) {
      return null;
    }

    return materializeSession(normalizedWaId, row.wa_id ?? normalizedWaId, row.session_data);
  } catch (error) {
    console.error('Unexpected error fetching lead session from Supabase', error);
    return null;
  }
};

const cacheSession = (session: LeadSession): LeadSession => {
  inMemorySessions.set(session.normalizedWaId, session);
  return session;
};

const buildSnapshot = (session: LeadSession): LeadSessionSnapshot => {
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

export const ensureLeadSession = async (params: {
  waId: string;
  normalizedWaId: string;
  profileName?: string;
}): Promise<LeadSession> => {
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
  } else {
    session.waId = waId;
    if (profileName && !session.name) {
      session.name = profileName;
    }
  }

  return session;
};

export const findLeadSession = async (normalizedWaId: string): Promise<LeadSession | null> => {
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

export const saveLeadSession = async (session: LeadSession): Promise<void> => {
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
  } catch (error) {
    console.error('Unexpected error saving lead session to Supabase', error);
  }
};
