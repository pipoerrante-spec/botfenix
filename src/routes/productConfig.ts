import { Router, Request, Response } from 'express';
import { getProductInfo, saveProductInfo, ProductInfo } from '../config/product';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  try {
    const product = getProductInfo();
    return res.json(product);
  } catch (error) {
    console.error('Error leyendo producto', error);
    return res.status(500).json({ error: 'No se pudo cargar el producto' });
  }
});

router.put('/', async (req: Request, res: Response) => {
  try {
    const payload = normalizeProductPayload(req.body ?? {});
    await saveProductInfo(payload);
    return res.json({ message: 'Producto actualizado', product: payload });
  } catch (error) {
    console.error('Error guardando producto', error);
    return res.status(400).json({ error: (error as Error).message });
  }
});

const normalizeProductPayload = (raw: Record<string, unknown>): ProductInfo => {
  const name = requireString(raw.name, 'name');
  const sku = requireString(raw.sku, 'sku');
  const price = parsePrice(raw.price);
  const currency = requireString(raw.currency, 'currency');
  const shortDescription = requireString(raw.shortDescription, 'shortDescription');
  const highlights = parseStringArray(raw.highlights, 'highlights');
  const materials = parseStringArray(raw.materials, 'materials');
  const packageIncludes = requireString(raw.packageIncludes, 'packageIncludes');
  const deliveryPromise = requireString(raw.deliveryPromise, 'deliveryPromise');
  const pitch = requireString(raw.pitch, 'pitch');

  return {
    name,
    sku,
    price,
    currency,
    shortDescription,
    highlights,
    materials,
    packageIncludes,
    deliveryPromise,
    pitch,
  };
};

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== 'string') {
    throw new Error(`El campo ${field} es obligatorio`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`El campo ${field} no puede estar vacío`);
  }
  return normalized;
};

const parsePrice = (value: unknown): number => {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error('price debe ser un número mayor a 0');
  }
  return Number(num.toFixed(2));
};

const parseStringArray = (value: unknown, field: string): string[] => {
  if (Array.isArray(value)) {
    const items = value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
    if (!items.length) {
      throw new Error(`El campo ${field} debe incluir al menos un elemento`);
    }
    return items;
  }

  if (typeof value === 'string') {
    const items = value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!items.length) {
      throw new Error(`El campo ${field} debe incluir al menos un elemento`);
    }
    return items;
  }

  throw new Error(`El campo ${field} debe enviarse como arreglo o texto separado por saltos de línea`);
};

export default router;
