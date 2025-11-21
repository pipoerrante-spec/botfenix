"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listProductMedia = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const crypto_1 = require("crypto");
const node_fetch_1 = __importDefault(require("node-fetch"));
const fluent_ffmpeg_1 = __importDefault(require("fluent-ffmpeg"));
const ffmpeg_1 = __importDefault(require("@ffmpeg-installer/ffmpeg"));
const supabase_js_1 = require("@supabase/supabase-js");
const env_1 = require("../config/env");
const CACHE_TTL_MS = 5 * 60 * 1000;
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 6;
const MAX_RECURSION_DEPTH = 5;
const CONVERTED_MEDIA_DIR = 'converted-media';
const mediaExtensions = {
    image: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    video: ['mp4', 'mov', 'avi', 'webm'],
};
const fallbackMediaPath = path_1.default.join(process.cwd(), 'data', 'mediaFallback.json');
let cache = null;
const convertedVideoCache = new Map();
fluent_ffmpeg_1.default.setFfmpegPath(ffmpeg_1.default.path);
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
const ensureVideoAssetsAreCompatible = async (client, assets) => {
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
        }
        catch (error) {
            console.error('No se pudo convertir el video a MP4, se enviará el original como enlace', error);
        }
    });
    await Promise.all(tasks);
};
const convertVideoToMp4 = async (client, asset) => {
    const tempDir = await fs_1.default.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), 'media-convert-'));
    const inputPath = path_1.default.join(tempDir, `source.${asset.extension ?? 'mov'}`);
    const outputPath = path_1.default.join(tempDir, 'output.mp4');
    try {
        const response = await (0, node_fetch_1.default)(asset.url);
        if (!response.ok) {
            throw new Error(`No se pudo descargar ${asset.url}: ${response.statusText}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        await fs_1.default.promises.writeFile(inputPath, buffer);
        await new Promise((resolve, reject) => {
            (0, fluent_ffmpeg_1.default)(inputPath)
                .outputOptions(['-movflags', 'faststart'])
                .format('mp4')
                .save(outputPath)
                .on('end', () => resolve())
                .on('error', (error) => reject(error));
        });
        const mp4Buffer = await fs_1.default.promises.readFile(outputPath);
        const hash = (0, crypto_1.createHash)('sha1').update(asset.url).digest('hex');
        const storagePath = `${CONVERTED_MEDIA_DIR}/${hash}.mp4`;
        await client.storage.from(env_1.env.supabaseMediaBucket).upload(storagePath, mp4Buffer, {
            upsert: true,
            contentType: 'video/mp4',
        });
        const publicUrl = client.storage.from(env_1.env.supabaseMediaBucket).getPublicUrl(storagePath).data?.publicUrl;
        return publicUrl ?? asset.url;
    }
    finally {
        await fs_1.default.promises.rm(tempDir, { recursive: true, force: true });
    }
};
