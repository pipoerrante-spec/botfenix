"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const supabase_js_1 = require("@supabase/supabase-js");
const productCatalogService_1 = require("../services/productCatalogService");
const env_1 = require("../config/env");
const product_1 = require("../config/product");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const normalizeProductPayload = (raw) => {
    const requireString = (value, field) => {
        if (typeof value !== 'string') {
            throw new Error(`El campo ${field} es obligatorio`);
        }
        const normalized = value.trim();
        if (!normalized) {
            throw new Error(`El campo ${field} no puede estar vacío`);
        }
        return normalized;
    };
    const parseLines = (value, field) => {
        if (Array.isArray(value)) {
            const list = value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
            if (!list.length) {
                throw new Error(`El campo ${field} debe contener al menos un elemento`);
            }
            return list;
        }
        if (typeof value === 'string') {
            const list = value
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean);
            if (!list.length) {
                throw new Error(`El campo ${field} debe contener al menos un elemento`);
            }
            return list;
        }
        throw new Error(`El campo ${field} debe ser texto o lista`);
    };
    const parsePrice = (value) => {
        const num = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(num) || num <= 0) {
            throw new Error('price debe ser un número mayor a 0');
        }
        return Number(num.toFixed(2));
    };
    return {
        name: requireString(raw.name, 'name'),
        sku: requireString(raw.sku, 'sku'),
        price: parsePrice(raw.price),
        currency: requireString(raw.currency, 'currency').toUpperCase(),
        shortDescription: requireString(raw.shortDescription, 'shortDescription'),
        highlights: parseLines(raw.highlights, 'highlights'),
        materials: parseLines(raw.materials, 'materials'),
        packageIncludes: requireString(raw.packageIncludes, 'packageIncludes'),
        deliveryPromise: requireString(raw.deliveryPromise, 'deliveryPromise'),
        pitch: requireString(raw.pitch, 'pitch'),
    };
};
const ensureSupabaseClient = () => {
    if (!env_1.env.supabase?.url || !env_1.env.supabase?.serviceRoleKey) {
        throw new Error('Supabase no está configurado');
    }
    if (!env_1.env.supabaseMediaBucket) {
        throw new Error('Falta PRODUCT_MEDIA_BUCKET');
    }
    return (0, supabase_js_1.createClient)(env_1.env.supabase.url, env_1.env.supabase.serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
};
router.get('/products', (_req, res) => {
    try {
        const catalog = (0, productCatalogService_1.listCatalogProducts)();
        return res.json(catalog);
    }
    catch (error) {
        console.error('Error listando productos del catálogo', error);
        return res.status(500).json({ error: 'No se pudo cargar el catálogo' });
    }
});
router.get('/products/:productId', (req, res) => {
    try {
        const product = (0, productCatalogService_1.getCatalogProduct)(req.params.productId);
        if (!product) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }
        return res.json(product);
    }
    catch (error) {
        console.error('Error obteniendo producto', error);
        return res.status(500).json({ error: 'No se pudo obtener el producto' });
    }
});
router.post('/products', async (req, res) => {
    try {
        const payload = normalizeProductPayload(req.body ?? {});
        const product = await (0, productCatalogService_1.createCatalogProduct)(payload);
        return res.json(product);
    }
    catch (error) {
        console.error('Error creando producto', error);
        return res.status(400).json({ error: error.message });
    }
});
router.put('/products/:productId', async (req, res) => {
    try {
        const payload = normalizeProductPayload(req.body ?? {});
        const product = await (0, productCatalogService_1.updateCatalogProduct)(req.params.productId, payload);
        return res.json(product);
    }
    catch (error) {
        console.error('Error actualizando producto', error);
        return res.status(400).json({ error: error.message });
    }
});
router.delete('/products/:productId', async (req, res) => {
    try {
        await (0, productCatalogService_1.removeCatalogProduct)(req.params.productId);
        return res.json({ message: 'Producto eliminado' });
    }
    catch (error) {
        console.error('Error eliminando producto', error);
        return res.status(400).json({ error: error.message });
    }
});
router.post('/products/:productId/activate', async (req, res) => {
    try {
        const product = await (0, productCatalogService_1.setActiveCatalogProduct)(req.params.productId);
        if (product) {
            await (0, product_1.saveProductInfo)({
                name: product.name,
                sku: product.sku,
                price: product.price,
                currency: product.currency,
                shortDescription: product.shortDescription,
                highlights: product.highlights,
                materials: product.materials,
                packageIncludes: product.packageIncludes,
                deliveryPromise: product.deliveryPromise,
                pitch: product.pitch,
            });
        }
        return res.json({ activeProductId: product?.id ?? null, product });
    }
    catch (error) {
        console.error('Error activando producto', error);
        return res.status(400).json({ error: error.message });
    }
});
router.post('/products/:productId/media/upload', upload.single('file'), async (req, res) => {
    try {
        const { productId } = req.params;
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: 'Falta archivo' });
        }
        const client = ensureSupabaseClient();
        const bucket = env_1.env.supabaseMediaBucket;
        const baseName = path_1.default.basename(file.originalname).replace(/[^a-z0-9.\-_]+/gi, '_');
        const objectPath = `catalog/${productId}/${Date.now()}-${baseName}`;
        const { error: uploadError } = await client.storage.from(bucket).upload(objectPath, file.buffer, {
            cacheControl: '3600',
            upsert: true,
            contentType: file.mimetype,
        });
        if (uploadError) {
            throw uploadError;
        }
        const publicUrl = client.storage.from(bucket).getPublicUrl(objectPath).data?.publicUrl;
        if (!publicUrl) {
            throw new Error('No se pudo obtener la URL pública del archivo');
        }
        const extension = path_1.default.extname(baseName).replace('.', '').toLowerCase();
        const type = file.mimetype.startsWith('video/') ? 'video' : 'image';
        const caption = typeof req.body.caption === 'string' ? req.body.caption.trim() : undefined;
        const media = await (0, productCatalogService_1.addMediaToCatalogProduct)(productId, {
            type,
            url: publicUrl,
            caption,
            extension: extension || undefined,
            storagePath: objectPath,
        });
        return res.json({ media });
    }
    catch (error) {
        console.error('Error subiendo media', error);
        const message = error instanceof Error ? error.message : 'Error al subir media';
        return res.status(400).json({ error: message });
    }
});
router.get('/products/:productId/media', (req, res) => {
    try {
        const product = (0, productCatalogService_1.getCatalogProduct)(req.params.productId);
        if (!product) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }
        return res.json(product.media ?? []);
    }
    catch (error) {
        console.error('Error obteniendo media', error);
        return res.status(500).json({ error: 'No se pudo obtener media' });
    }
});
router.delete('/products/:productId/media/:mediaId', async (req, res) => {
    try {
        await (0, productCatalogService_1.removeMediaFromCatalogProduct)(req.params.productId, req.params.mediaId);
        return res.json({ message: 'Media eliminada' });
    }
    catch (error) {
        console.error('Error eliminando media', error);
        return res.status(400).json({ error: error.message });
    }
});
router.put('/products/:productId/media/:mediaId', async (req, res) => {
    try {
        const caption = typeof req.body.caption === 'string' ? req.body.caption : undefined;
        const media = await (0, productCatalogService_1.updateMediaDetails)(req.params.productId, req.params.mediaId, { caption });
        return res.json(media);
    }
    catch (error) {
        console.error('Error actualizando media', error);
        return res.status(400).json({ error: error.message });
    }
});
router.post('/products/:productId/media/reorder', async (req, res) => {
    try {
        const order = Array.isArray(req.body?.order) ? req.body.order : [];
        if (!order.length) {
            throw new Error('Debes enviar un arreglo order con los IDs');
        }
        const media = await (0, productCatalogService_1.reorderProductMedia)(req.params.productId, order);
        return res.json(media);
    }
    catch (error) {
        console.error('Error reordenando media', error);
        return res.status(400).json({ error: error.message });
    }
});
router.get('/active', (_req, res) => {
    try {
        const product = (0, productCatalogService_1.getActiveCatalogProduct)();
        return res.json({ product });
    }
    catch (error) {
        console.error('Error obteniendo producto activo', error);
        return res.status(500).json({ error: 'No se pudo obtener el producto activo' });
    }
});
exports.default = router;
