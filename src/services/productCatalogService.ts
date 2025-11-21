import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { ProductInfo } from '../types/product';

export type CatalogMediaType = 'image' | 'video';

export interface CatalogMediaItem {
  id: string;
  type: CatalogMediaType;
  url: string;
  caption?: string;
  extension?: string;
  storagePath?: string;
  sortOrder: number;
  createdAt: string;
}

export interface CatalogProduct extends ProductInfo {
  id: string;
  createdAt: string;
  updatedAt: string;
  media: CatalogMediaItem[];
}

export interface ProductCatalog {
  activeProductId: string | null;
  products: CatalogProduct[];
}

const catalogFilePath = path.join(process.cwd(), 'data', 'productCatalog.json');

const readCatalog = (): ProductCatalog => {
  try {
    if (!fs.existsSync(catalogFilePath)) {
      return { activeProductId: null, products: [] };
    }
    const raw = fs.readFileSync(catalogFilePath, 'utf-8');
    const parsed = JSON.parse(raw) as ProductCatalog;
    return {
      activeProductId: parsed.activeProductId ?? null,
      products: Array.isArray(parsed.products) ? parsed.products : [],
    };
  } catch (error) {
    console.error('No se pudo leer productCatalog.json, se usará uno vacío', error);
    return { activeProductId: null, products: [] };
  }
};

const writeCatalog = async (catalog: ProductCatalog): Promise<void> => {
  await fs.promises.mkdir(path.dirname(catalogFilePath), { recursive: true });
  await fs.promises.writeFile(catalogFilePath, JSON.stringify(catalog, null, 2), 'utf-8');
};

const sanitizeProductPayload = (payload: ProductInfo): ProductInfo => {
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

export const listCatalogProducts = (): ProductCatalog => {
  return readCatalog();
};

export const getCatalogProduct = (id: string): CatalogProduct | undefined => {
  if (!id) {
    return undefined;
  }
  const catalog = readCatalog();
  return catalog.products.find((product) => product.id === id);
};

export const getActiveCatalogProduct = (): CatalogProduct | undefined => {
  const catalog = readCatalog();
  if (!catalog.activeProductId) {
    return undefined;
  }
  return catalog.products.find((product) => product.id === catalog.activeProductId);
};

export const createCatalogProduct = async (payload: ProductInfo): Promise<CatalogProduct> => {
  const catalog = readCatalog();
  const now = new Date().toISOString();
  const product: CatalogProduct = {
    ...sanitizeProductPayload(payload),
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    media: [],
  };
  catalog.products.push(product);
  await writeCatalog(catalog);
  return product;
};

export const updateCatalogProduct = async (productId: string, payload: ProductInfo): Promise<CatalogProduct> => {
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

export const removeCatalogProduct = async (productId: string): Promise<void> => {
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

export const setActiveCatalogProduct = async (productId: string | null): Promise<CatalogProduct | null> => {
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

export const addMediaToCatalogProduct = async (
  productId: string,
  media: Omit<CatalogMediaItem, 'id' | 'createdAt' | 'sortOrder'>,
): Promise<CatalogMediaItem> => {
  const catalog = readCatalog();
  const product = catalog.products.find((item) => item.id === productId);
  if (!product) {
    throw new Error('Producto no encontrado');
  }
  const createdAt = new Date().toISOString();
  const nextSortOrder =
    product.media.length === 0 ? 0 : Math.max(...product.media.map((item) => item.sortOrder)) + 1;
  const item: CatalogMediaItem = {
    ...media,
    id: randomUUID(),
    createdAt,
    sortOrder: nextSortOrder,
  };
  product.media.push(item);
  product.updatedAt = createdAt;
  await writeCatalog(catalog);
  return item;
};

export const removeMediaFromCatalogProduct = async (productId: string, mediaId: string): Promise<void> => {
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

export const updateMediaDetails = async (
  productId: string,
  mediaId: string,
  data: Pick<CatalogMediaItem, 'caption'>,
): Promise<CatalogMediaItem> => {
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

export const getActiveProductMedia = (): CatalogMediaItem[] => {
  const active = getActiveCatalogProduct();
  if (!active || !active.media?.length) {
    return [];
  }
  return [...active.media].sort((a, b) => a.sortOrder - b.sortOrder);
};

export const reorderProductMedia = async (
  productId: string,
  order: string[],
): Promise<CatalogMediaItem[]> => {
  const catalog = readCatalog();
  const product = catalog.products.find((item) => item.id === productId);
  if (!product) {
    throw new Error('Producto no encontrado');
  }
  const orderMap = new Map(order.map((id, index) => [id, index]));
  product.media = product.media
    .map((item) => ({
      ...item,
      sortOrder: orderMap.has(item.id) ? orderMap.get(item.id)! : item.sortOrder,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item, index) => ({ ...item, sortOrder: index }));
  product.updatedAt = new Date().toISOString();
  await writeCatalog(catalog);
  return product.media;
};
