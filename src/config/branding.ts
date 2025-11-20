import fs from 'fs';
import path from 'path';

export interface BrandingTheme {
  background: string;
  panel: string;
  primary: string;
  secondary: string;
  accent: string;
  text: string;
  textMuted: string;
  border: string;
}

export interface BrandingConfig {
  botName: string;
  statusLine: string;
  carrierLabel: string;
  greeting: string;
  placeholder: string;
  avatarInitials?: string;
  theme: BrandingTheme;
}

const brandingFilePath = path.join(process.cwd(), 'data', 'branding.json');

const parseBrandingFile = (): BrandingConfig => {
  try {
    const raw = fs.readFileSync(brandingFilePath, 'utf-8');
    return JSON.parse(raw) as BrandingConfig;
  } catch (error) {
    throw new Error(`No se pudo leer data/branding.json: ${(error as Error).message}`);
  }
};

export const getBrandingConfig = (): BrandingConfig => {
  return parseBrandingFile();
};

export const saveBrandingConfig = async (config: BrandingConfig): Promise<void> => {
  await fs.promises.mkdir(path.dirname(brandingFilePath), { recursive: true });
  await fs.promises.writeFile(brandingFilePath, JSON.stringify(config, null, 2), 'utf-8');
};
