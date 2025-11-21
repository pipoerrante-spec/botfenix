"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reorderProductMedia = exports.getActiveProductMedia = exports.updateMediaDetails = exports.removeMediaFromCatalogProduct = exports.addMediaToCatalogProduct = exports.setActiveCatalogProduct = exports.removeCatalogProduct = exports.updateCatalogProduct = exports.createCatalogProduct = exports.getActiveCatalogProduct = exports.getCatalogProduct = exports.listCatalogProducts = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const catalogFilePath = path_1.default.join(process.cwd(), 'data', 'productCatalog.json');
const readCatalog = () => {
    try {
        if (!fs_1.default.existsSync(catalogFilePath)) {
            return { activeProductId: null, products: [] };
        }
        const raw = fs_1.default.readFileSync(catalogFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
            activeProductId: parsed.activeProductId ?? null,
            products: Array.isArray(parsed.products) ? parsed.products : [],
        };
    }
    catch (error) {
        console.error('No se pudo leer productCatalog.json, se usará uno vacío', error);
        return { activeProductId: null, products: [] };
    }
};
const writeCatalog = async (catalog) => {
    await fs_1.default.promises.mkdir(path_1.default.dirname(catalogFilePath), { recursive: true });
    await fs_1.default.promises.writeFile(catalogFilePath, JSON.stringify(catalog, null, 2), 'utf-8');
};
const sanitizeProductPayload = (payload) => {
    return {
        name: payload.name.trim(),
        sku: payload.sku.trim(),
        price: Number(payload.price),
        currency: payload.currency.trim().toUpperCase(),
        shortDescription: payload.shortDescription.trim(),
        highlights: payload.highlights.map((item) => item.trim()).filter(Boolean),
        materials: payload.materials.map((item) => item.trim()).filter(Boolean),
        packageIncludes: payload.packageIncludes.trim(),
        deliveryPromise: payload.deliveryPromise.trim(),
        pitch: payload.pitch.trim(),
    };
};
const listCatalogProducts = () => {
    return readCatalog();
};
exports.listCatalogProducts = listCatalogProducts;
const getCatalogProduct = (id) => {
    if (!id) {
        return undefined;
    }
    const catalog = readCatalog();
    return catalog.products.find((product) => product.id === id);
};
exports.getCatalogProduct = getCatalogProduct;
const getActiveCatalogProduct = () => {
    const catalog = readCatalog();
    if (!catalog.activeProductId) {
        return undefined;
    }
    return catalog.products.find((product) => product.id === catalog.activeProductId);
};
exports.getActiveCatalogProduct = getActiveCatalogProduct;
const createCatalogProduct = async (payload) => {
    const catalog = readCatalog();
    const now = new Date().toISOString();
    const product = {
        ...sanitizeProductPayload(payload),
        id: (0, crypto_1.randomUUID)(),
        createdAt: now,
        updatedAt: now,
        media: [],
    };
    catalog.products.push(product);
    await writeCatalog(catalog);
    return product;
};
exports.createCatalogProduct = createCatalogProduct;
const updateCatalogProduct = async (productId, payload) => {
    const catalog = readCatalog();
    const index = catalog.products.findIndex((product) => product.id === productId);
    if (index === -1) {
        throw new Error('Producto no encontrado');
    }
    const now = new Date().toISOString();
    catalog.products[index] = {
        ...catalog.products[index],
        ...sanitizeProductPayload(payload),
        updatedAt: now,
    };
    await writeCatalog(catalog);
    return catalog.products[index];
};
exports.updateCatalogProduct = updateCatalogProduct;
const removeCatalogProduct = async (productId) => {
    const catalog = readCatalog();
    const index = catalog.products.findIndex((product) => product.id === productId);
    if (index === -1) {
        throw new Error('Producto no encontrado');
    }
    catalog.products.splice(index, 1);
    if (catalog.activeProductId === productId) {
        catalog.activeProductId = null;
    }
    await writeCatalog(catalog);
};
exports.removeCatalogProduct = removeCatalogProduct;
const setActiveCatalogProduct = async (productId) => {
    const catalog = readCatalog();
    if (!productId) {
        catalog.activeProductId = null;
        await writeCatalog(catalog);
        return null;
    }
    const product = catalog.products.find((item) => item.id === productId);
    if (!product) {
        throw new Error('Producto no encontrado');
    }
    catalog.activeProductId = product.id;
    await writeCatalog(catalog);
    return product;
};
exports.setActiveCatalogProduct = setActiveCatalogProduct;
const addMediaToCatalogProduct = async (productId, media) => {
    const catalog = readCatalog();
    const product = catalog.products.find((item) => item.id === productId);
    if (!product) {
        throw new Error('Producto no encontrado');
    }
    const createdAt = new Date().toISOString();
    const nextSortOrder = product.media.length === 0 ? 0 : Math.max(...product.media.map((item) => item.sortOrder)) + 1;
    const item = {
        ...media,
        id: (0, crypto_1.randomUUID)(),
        createdAt,
        sortOrder: nextSortOrder,
    };
    product.media.push(item);
    product.updatedAt = createdAt;
    await writeCatalog(catalog);
    return item;
};
exports.addMediaToCatalogProduct = addMediaToCatalogProduct;
const removeMediaFromCatalogProduct = async (productId, mediaId) => {
    const catalog = readCatalog();
    const product = catalog.products.find((item) => item.id === productId);
    if (!product) {
        throw new Error('Producto no encontrado');
    }
    const index = product.media.findIndex((item) => item.id === mediaId);
    if (index === -1) {
        throw new Error('Media no encontrada');
    }
    product.media.splice(index, 1);
    product.updatedAt = new Date().toISOString();
    await writeCatalog(catalog);
};
exports.removeMediaFromCatalogProduct = removeMediaFromCatalogProduct;
const updateMediaDetails = async (productId, mediaId, data) => {
    const catalog = readCatalog();
    const product = catalog.products.find((item) => item.id === productId);
    if (!product) {
        throw new Error('Producto no encontrado');
    }
    const media = product.media.find((item) => item.id === mediaId);
    if (!media) {
        throw new Error('Media no encontrada');
    }
    if (typeof data.caption === 'string') {
        media.caption = data.caption.trim();
    }
    product.updatedAt = new Date().toISOString();
    await writeCatalog(catalog);
    return media;
};
exports.updateMediaDetails = updateMediaDetails;
const getActiveProductMedia = () => {
    const active = (0, exports.getActiveCatalogProduct)();
    if (!active || !active.media?.length) {
        return [];
    }
    return [...active.media].sort((a, b) => a.sortOrder - b.sortOrder);
};
exports.getActiveProductMedia = getActiveProductMedia;
const reorderProductMedia = async (productId, order) => {
    const catalog = readCatalog();
    const product = catalog.products.find((item) => item.id === productId);
    if (!product) {
        throw new Error('Producto no encontrado');
    }
    const orderMap = new Map(order.map((id, index) => [id, index]));
    product.media = product.media
        .map((item) => ({
        ...item,
        sortOrder: orderMap.has(item.id) ? orderMap.get(item.id) : item.sortOrder,
    }))
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((item, index) => ({ ...item, sortOrder: index }));
    product.updatedAt = new Date().toISOString();
    await writeCatalog(catalog);
    return product.media;
};
exports.reorderProductMedia = reorderProductMedia;
