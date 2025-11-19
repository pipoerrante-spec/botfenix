import fs from 'fs';
import path from 'path';

export interface ProductInfo {
  name: string;
  sku: string;
  price: number;
  currency: string;
  shortDescription: string;
  highlights: string[];
  materials: string[];
  packageIncludes: string;
  deliveryPromise: string;
  pitch: string;
}

const productFilePath = path.join(process.cwd(), 'data', 'product.json');

const parseProductFile = (): ProductInfo => {
  try {
    const raw = fs.readFileSync(productFilePath, 'utf-8');
    return JSON.parse(raw) as ProductInfo;
  } catch (error) {
    throw new Error(`No se pudo leer data/product.json: ${(error as Error).message}`);
  }
};

export const getProductInfo = (): ProductInfo => {
  return parseProductFile();
};

export const saveProductInfo = async (info: ProductInfo): Promise<void> => {
  await fs.promises.mkdir(path.dirname(productFilePath), { recursive: true });
  await fs.promises.writeFile(productFilePath, JSON.stringify(info, null, 2), 'utf-8');
};

export const formatProductBulletPoints = (info: ProductInfo = getProductInfo()): string => {
  const highlights = info.highlights.map((point) => `- ${point}`).join('\n');
  const materials = info.materials.map((material) => `- ${material}`).join('\n');

  return [
    `Nombre: ${info.name} (SKU: ${info.sku})`,
    `Precio sugerido: ${info.currency} ${info.price}`,
    `Descripción: ${info.shortDescription}`,
    `Beneficios clave:\n${highlights}`,
    `Materiales:\n${materials}`,
    `Contenido del paquete: ${info.packageIncludes}`,
    `Entrega: ${info.deliveryPromise}`,
    `Pitch comercial: ${info.pitch}`,
  ].join('\n\n');
};
