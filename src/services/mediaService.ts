import { createClient } from '@supabase/supabase-js';
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

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: MediaCache | null = null;

const mediaExtensions: Record<MediaAssetType, string[]> = {
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
  video: ['mp4', 'mov', 'avi', 'webm'],
};

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

export const listProductMedia = async (): Promise<MediaAsset[]> => {
  if (!env.supabase?.url || !env.supabase?.serviceRoleKey || !env.supabaseMediaBucket) {
    return [];
  }

  if (cache && cache.expiresAt > Date.now()) {
    return cache.assets;
  }

  const client = createClient(env.supabase.url, env.supabase.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: files, error } = await client.storage.from(env.supabaseMediaBucket).list(undefined, {
      limit: 50,
    });

    if (error) {
      throw error;
    }

    const assets: MediaAsset[] = [];
    for (const file of files ?? []) {
      if (!file.name) {
        continue;
      }
      const [_, ext = ''] = /\.([^.]+)$/.exec(file.name) ?? [];
      const type = resolveTypeFromExtension(ext);
      if (!type) {
        continue;
      }

      const { data: publicUrlData } = client.storage.from(env.supabaseMediaBucket).getPublicUrl(file.name);
      if (!publicUrlData?.publicUrl) {
        continue;
      }

      assets.push({
        type,
        url: publicUrlData.publicUrl,
        caption: file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
      });
    }

    cache = { assets, expiresAt: Date.now() + CACHE_TTL_MS };
    return assets;
  } catch (error) {
    console.error('Error al cargar media desde Supabase', error);
    return [];
  }
};
