import fs from 'fs';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env';
import { getActiveProductMedia } from './productCatalogService';

export type MediaAssetType = 'image' | 'video';

export interface MediaAsset {
  type: MediaAssetType;
  url: string;
  caption?: string;
  extension?: string;
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
const CONVERTED_MEDIA_DIR = 'converted-media';
const mediaExtensions: Record<MediaAssetType, string[]> = {
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
  video: ['mp4', 'mov', 'avi', 'webm'],
};

const fallbackMediaPath = path.join(process.cwd(), 'data', 'mediaFallback.json');

let cache: MediaCache | null = null;
const convertedVideoCache = new Map<string, string>();
type FetchModule = typeof import('node-fetch');
type FetchFn = FetchModule['default'];
let cachedFetch: FetchFn | null = null;
const dynamicImport = new Function('modulePath', 'return import(modulePath);') as (
  modulePath: string,
) => Promise<unknown>;

const loadFetch = async (): Promise<FetchFn> => {
  if (cachedFetch) {
    return cachedFetch;
  }
  const mod = (await dynamicImport('node-fetch')) as FetchModule;
  cachedFetch = mod.default;
  return cachedFetch;
};

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

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
  const catalogMedia = getActiveProductMedia();
  if (catalogMedia.length) {
    const assets = catalogMedia
      .filter((item) => Boolean(item.url))
      .map<MediaAsset>((item) => ({
        type: item.type,
        url: item.url,
        caption: item.caption,
        extension: item.extension,
      }));
    cache = { assets, expiresAt: Date.now() + CACHE_TTL_MS };
    return assets;
  }

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
      const [, extRaw = ''] = /\.([^.]+)$/.exec(filePath) ?? [];
      const ext = extRaw.toLowerCase();
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
        extension: ext,
      });
    }

    if (assets.length) {
      await ensureVideoAssetsAreCompatible(client, assets);
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

const ensureVideoAssetsAreCompatible = async (client: SupabaseClient, assets: MediaAsset[]): Promise<void> => {
  const tasks = assets.map(async (asset) => {
    if (asset.type !== 'video') {
      return;
    }
    if (asset.extension === 'mp4') {
      return;
    }

    const cachedUrl = convertedVideoCache.get(asset.url);
    if (cachedUrl) {
      asset.url = cachedUrl;
      asset.extension = 'mp4';
      return;
    }

    try {
      const mp4Url = await convertVideoToMp4(client, asset);
      if (mp4Url) {
        convertedVideoCache.set(asset.url, mp4Url);
        asset.url = mp4Url;
        asset.extension = 'mp4';
      }
    } catch (error) {
      console.error('No se pudo convertir el video a MP4, se enviará el original como enlace', error);
    }
  });

  await Promise.all(tasks);
};

const convertVideoToMp4 = async (client: SupabaseClient, asset: MediaAsset): Promise<string | null> => {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'media-convert-'));
  const inputPath = path.join(tempDir, `source.${asset.extension ?? 'mov'}`);
  const outputPath = path.join(tempDir, 'output.mp4');

  try {
    const fetch = await loadFetch();
    const response = await fetch(asset.url);
    if (!response.ok) {
      throw new Error(`No se pudo descargar ${asset.url}: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.promises.writeFile(inputPath, buffer);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions(['-movflags', 'faststart'])
        .format('mp4')
        .save(outputPath)
        .on('end', () => resolve())
        .on('error', (error) => reject(error));
    });

    const mp4Buffer = await fs.promises.readFile(outputPath);
    const hash = createHash('sha1').update(asset.url).digest('hex');
    const storagePath = `${CONVERTED_MEDIA_DIR}/${hash}.mp4`;

    await client.storage.from(env.supabaseMediaBucket!).upload(storagePath, mp4Buffer, {
      upsert: true,
      contentType: 'video/mp4',
    });

    const publicUrl = client.storage.from(env.supabaseMediaBucket!).getPublicUrl(storagePath).data?.publicUrl;
    return publicUrl ?? asset.url;
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
};
