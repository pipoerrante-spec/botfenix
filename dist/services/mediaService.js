"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listProductMedia = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const env_1 = require("../config/env");
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = null;
const mediaExtensions = {
    image: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    video: ['mp4', 'mov', 'avi', 'webm'],
};
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
const listProductMedia = async () => {
    if (!env_1.env.supabase?.url || !env_1.env.supabase?.serviceRoleKey || !env_1.env.supabaseMediaBucket) {
        return [];
    }
    if (cache && cache.expiresAt > Date.now()) {
        return cache.assets;
    }
    const client = (0, supabase_js_1.createClient)(env_1.env.supabase.url, env_1.env.supabase.serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
    try {
        const { data: files, error } = await client.storage.from(env_1.env.supabaseMediaBucket).list(undefined, {
            limit: 50,
        });
        if (error) {
            throw error;
        }
        const assets = [];
        for (const file of files ?? []) {
            if (!file.name) {
                continue;
            }
            const [_, ext = ''] = /\.([^.]+)$/.exec(file.name) ?? [];
            const type = resolveTypeFromExtension(ext);
            if (!type) {
                continue;
            }
            const { data: publicUrlData } = client.storage.from(env_1.env.supabaseMediaBucket).getPublicUrl(file.name);
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
    }
    catch (error) {
        console.error('Error al cargar media desde Supabase', error);
        return [];
    }
};
exports.listProductMedia = listProductMedia;
