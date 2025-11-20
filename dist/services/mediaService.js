"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listProductMedia = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const supabase_js_1 = require("@supabase/supabase-js");
const env_1 = require("../config/env");
const CACHE_TTL_MS = 5 * 60 * 1000;
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 6;
const MAX_RECURSION_DEPTH = 5;
const mediaExtensions = {
    image: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    video: ['mp4', 'mov', 'avi', 'webm'],
};
const fallbackMediaPath = path_1.default.join(process.cwd(), 'data', 'mediaFallback.json');
let cache = null;
const resolveTypeFromExtension = (ext) => {
    const normalized = ext.toLowerCase();
    if (mediaExtensions.image.includes(normalized)) {
        return 'image';
    }
    if (mediaExtensions.video.includes(normalized)) {
        return 'video';
    }
    return undefined;
};
const looksLikeFile = (entry) => {
    if (!entry.name) {
        return false;
    }
    if (entry.metadata && 'size' in entry.metadata) {
        return true;
    }
    return /\.[^.]+$/.test(entry.name);
};
const normalizePath = (path) => {
    if (!path) {
        return undefined;
    }
    const trimmed = path.replace(/^\/+|\/+$/g, '');
    return trimmed.length ? trimmed : undefined;
};
const buildCaption = (filePath) => {
    const name = filePath.split('/').pop() ?? filePath;
    return name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
};
const enumerateFiles = async (client, path, depth = 0) => {
    if (depth > MAX_RECURSION_DEPTH) {
        return [];
    }
    const { data: entries, error } = await client.storage.from(env_1.env.supabaseMediaBucket).list(path, {
        limit: 100,
    });
    if (error) {
        throw error;
    }
    const files = [];
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
const resolveFileUrl = async (client, filePath) => {
    const publicUrl = client.storage.from(env_1.env.supabaseMediaBucket).getPublicUrl(filePath).data?.publicUrl;
    if (publicUrl) {
        return publicUrl;
    }
    const { data, error } = await client
        .storage
        .from(env_1.env.supabaseMediaBucket)
        .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS);
    if (error) {
        console.error(`No se pudo generar URL firmada para ${filePath}`, error);
        return null;
    }
    return data?.signedUrl ?? null;
};
const listProductMedia = async () => {
    if (!env_1.env.supabase?.url || !env_1.env.supabase?.serviceRoleKey || !env_1.env.supabaseMediaBucket) {
        return loadFallbackAssets();
    }
    if (cache && cache.expiresAt > Date.now()) {
        return cache.assets;
    }
    const client = (0, supabase_js_1.createClient)(env_1.env.supabase.url, env_1.env.supabase.serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
    try {
        const basePath = normalizePath(env_1.env.supabaseMediaPrefix);
        const filePaths = await enumerateFiles(client, basePath);
        const assets = [];
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
    }
    catch (error) {
        console.error('Error al cargar media desde Supabase', error);
    }
    return loadFallbackAssets();
};
exports.listProductMedia = listProductMedia;
const loadFallbackAssets = () => {
    try {
        const raw = fs_1.default.readFileSync(fallbackMediaPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!parsed.length) {
            return [];
        }
        cache = { assets: parsed, expiresAt: Date.now() + CACHE_TTL_MS };
        return parsed;
    }
    catch (error) {
        console.error('No se pudo cargar data/mediaFallback.json', error);
        return [];
    }
};
