import fs from 'fs';
import path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env';

export type MediaAssetType = 'image' | 'video';

export interface MediaAsset {
  type: MediaAssetType;
  url: string;
  caption?: string;
}

interface MediaCache {
  assets: MediaAsset[];
  expiresAt: number;
}

type StorageEntry = {
  name: string;
  id?: string;
  metadata?: Record<string, unknown> | null;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 6;
const MAX_RECURSION_DEPTH = 5;
const mediaExtensions: Record<MediaAssetType, string[]> = {
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
  video: ['mp4', 'mov', 'avi', 'webm'],
};

const fallbackMediaPath = path.join(process.cwd(), 'data', 'mediaFallback.json');

let cache: MediaCache | null = null;

const resolveTypeFromExtension = (ext: string): MediaAssetType | undefined => {
  const normalized = ext.toLowerCase();
  if (mediaExtensions.image.includes(normalized)) {
    return 'image';
  }
  if (mediaExtensions.video.includes(normalized)) {
    return 'video';
  }
  return undefined;
};

const looksLikeFile = (entry: StorageEntry): boolean => {
  if (!entry.name) {
    return false;
  }
  if (entry.metadata && 'size' in entry.metadata) {
    return true;
  }
  return /\.[^.]+$/.test(entry.name);
};

const normalizePath = (path?: string | null): string | undefined => {
  if (!path) {
    return undefined;
  }
  const trimmed = path.replace(/^\/+|\/+$/g, '');
  return trimmed.length ? trimmed : undefined;
};

const buildCaption = (filePath: string): string => {
  const name = filePath.split('/').pop() ?? filePath;
  return name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
};

const enumerateFiles = async (
  client: SupabaseClient,
  path: string | undefined,
  depth = 0,
): Promise<string[]> => {
  if (depth > MAX_RECURSION_DEPTH) {
    return [];
  }

  const { data: entries, error } = await client.storage.from(env.supabaseMediaBucket!).list(path, {
    limit: 100,
  });

  if (error) {
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries ?? []) {
    const currentPath = path ? `${path}/${entry.name}` : entry.name;
    if (looksLikeFile(entry)) {
      files.push(currentPath);
      continue;
    }
    const nested = await enumerateFiles(client, currentPath, depth + 1);
    files.push(...nested);
  }

  return files;
};

const resolveFileUrl = async (
  client: SupabaseClient,
  filePath: string,
): Promise<string | null> => {
  const publicUrl = client.storage.from(env.supabaseMediaBucket!).getPublicUrl(filePath).data?.publicUrl;
  if (publicUrl) {
    return publicUrl;
  }

  const { data, error } = await client
    .storage
    .from(env.supabaseMediaBucket!)
    .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS);

  if (error) {
    console.error(`No se pudo generar URL firmada para ${filePath}`, error);
    return null;
  }

  return data?.signedUrl ?? null;
};

export const listProductMedia = async (): Promise<MediaAsset[]> => {
  if (!env.supabase?.url || !env.supabase?.serviceRoleKey || !env.supabaseMediaBucket) {
    return loadFallbackAssets();
  }

  if (cache && cache.expiresAt > Date.now()) {
    return cache.assets;
  }

  const client = createClient(env.supabase.url, env.supabase.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const basePath = normalizePath(env.supabaseMediaPrefix);
    const filePaths = await enumerateFiles(client, basePath);

    const assets: MediaAsset[] = [];
    for (const filePath of filePaths) {
      const [, ext = ''] = /\.([^.]+)$/.exec(filePath) ?? [];
      const type = resolveTypeFromExtension(ext);
      if (!type) {
        continue;
      }

      const url = await resolveFileUrl(client, filePath);
      if (!url) {
        continue;
      }

      assets.push({
        type,
        url,
        caption: buildCaption(filePath),
      });
    }

    if (assets.length) {
      cache = { assets, expiresAt: Date.now() + CACHE_TTL_MS };
      return assets;
    }
  } catch (error) {
    console.error('Error al cargar media desde Supabase', error);
  }

  return loadFallbackAssets();
};

const loadFallbackAssets = (): MediaAsset[] => {
  try {
    const raw = fs.readFileSync(fallbackMediaPath, 'utf-8');
    const parsed = JSON.parse(raw) as MediaAsset[];
    if (!parsed.length) {
      return [];
    }
    cache = { assets: parsed, expiresAt: Date.now() + CACHE_TTL_MS };
    return parsed;
  } catch (error) {
    console.error('No se pudo cargar data/mediaFallback.json', error);
    return [];
  }
};
