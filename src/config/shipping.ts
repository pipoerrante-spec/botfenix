import { randomUUID } from 'crypto';

export interface ShippingInfo {
  origin: string;
  companies: string[];
  costHint?: string;
  testimonials?: string[];
}

const normalizeCity = (city: string): string =>
  city
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

const SHIPPING_PROVIDERS: Record<string, ShippingInfo> = {
  pando: {
    origin: 'Santa Cruz',
    companies: ['Trans Pando', 'Trans Oriente'],
    costHint: 'PXP-PG  (15-35 Bs según terminal)',
    testimonials: [
      'Esta semana enviamos 2 kits a Cobija con Trans Pando y llegaron en menos de 36h.',
      'La última flota a Pando salió anoche por Trans Oriente y el cliente confirmó entrega perfecta.',
    ],
  },
  cobija: {
    origin: 'Santa Cruz',
    companies: ['Trans Pando'],
    costHint: 'PXP 15-35 Bs',
  },
  riberalta: {
    origin: 'Santa Cruz',
    companies: ['Max Fernandes', 'Trans Pando'],
    costHint: 'PG 15-35 Bs',
  },
  guayaramerin: {
    origin: 'Santa Cruz',
    companies: ['Trans Baruc', 'Trans Guarayos'],
  },
  montero: {
    origin: 'Santa Cruz',
    companies: ['Trans TRF Montero', 'Trans Bioceánico'],
    testimonials: [
      'Ayer entregamos 3 paquetes en Montero con Trans TRF; se despachó a las 10:00 y llegó en la tarde.',
      'Trans Bioceánico lleva nuestros pedidos a Montero prácticamente a diario; la gente los recoge en menos de 24h.',
      'Recientemente un cliente de Montero recibió su kit con Trans TRF y nos mandó foto de instalación el mismo día.',
    ],
  },
  yacuiba: {
    origin: 'Santa Cruz',
    companies: ['Trans 10 de Febrero', 'Trans La Querida'],
  },
  camiri: {
    origin: 'Santa Cruz',
    companies: ['Trans Baruc', 'Trans Camiri'],
  },
  bermejo: {
    origin: 'Santa Cruz',
    companies: ['Trans Baruc', 'Trans Bermejeño'],
  },
  trinidad: {
    origin: 'Santa Cruz',
    companies: ['Trans Pando', 'Trans Niño'],
    testimonials: ['Despachamos cada semana vía Trans Niño a Trinidad; el último llegó en 22 horas.'],
  },
  yucumo: {
    origin: 'Santa Cruz',
    companies: ['Trans Pando'],
  },
  caranavi: {
    origin: 'La Paz',
    companies: ['Trans 8 de Mayo', 'Trans Bolivia'],
    testimonials: ['Caranavi recibe nuestros envíos en la flota 8 de Mayo; el transportista ya conoce al cliente.', 'Trans Bolivia dejó ayer dos paquetes en Caranavi, todo impecable.'],
  },
  guanay: {
    origin: 'La Paz',
    companies: ['Yungueña'],
  },
  mapiri: {
    origin: 'La Paz',
    companies: ['Yungueña'],
  },
  copacabana: {
    origin: 'La Paz',
    companies: ['Flotas independientes del Terminal de Provincias'],
    testimonials: ['Los últimos envíos a Copacabana salieron en la tarde y amanecieron listos en terminal.'],
  },
  sorata: {
    origin: 'La Paz',
    companies: ['Servicios terminal de provincias'],
  },
  achacachi: {
    origin: 'La Paz',
    companies: ['Servicios terminal de provincias'],
  },
  batallas: {
    origin: 'La Paz',
    companies: ['Servicios terminal de provincias'],
  },
  vallegrande: {
    origin: 'Santa Cruz',
    companies: ['Trans Comarapa', 'Trans Vallegrande'],
  },
  yapacani: {
    origin: 'Santa Cruz',
    companies: ['Sindicato 16 de Julio'],
  },
  sanignacio: {
    origin: 'Santa Cruz',
    companies: ['Trans Aguila', 'Trans Baruc'],
  },
  sanjose: {
    origin: 'Santa Cruz',
    companies: ['Trans Baruc'],
  },
  concepcion: {
    origin: 'Santa Cruz',
    companies: ['Trans Guarayos'],
  },
  sanrafael: {
    origin: 'Santa Cruz',
    companies: ['Trans Guarayos'],
  },
  charagua: {
    origin: 'Santa Cruz',
    companies: ['Trans Charagua'],
  },
  mairana: {
    origin: 'Santa Cruz',
    companies: ['Trans Baruc'],
  },
  monteagudo: {
    origin: 'Sucre',
    companies: ['Max Fernandes'],
  },
  villamontes: {
    origin: 'Santa Cruz',
    companies: ['Trans Bioceánico', 'Trans La Querida'],
  },
  riberao: {
    origin: 'Santa Cruz',
    companies: ['Max Fernandes'],
  },
};

const TRUST_POOL = [
  'Acabamos de despachar 3 kits a la misma zona y todos confirmaron entrega sin contratiempos.',
  'Nuestro equipo de logística monitorea cada salida y te enviamos foto del comprobante apenas embarque.',
  'Trabajamos sólo con flotas que ya conocen el producto y saben cómo manipularlo a salvo.',
  'Incluso clientes que instalan por primera vez nos cuentan que lo reciben impecable gracias a nuestras flotas aliadas.',
  'Te compartimos el número de guía y el contacto del chofer para que sigas el viaje en tiempo real.',
];

const randomItem = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)];

export const getShippingConfidenceMessage = (city: string): {
  providerLine: string;
  testimonial: string;
} => {
  const normalized = normalizeCity(city);
  const info = SHIPPING_PROVIDERS[normalized];
  if (info) {
    const providerLine = `Enviamos desde ${info.origin} con ${info.companies.join(', ')} ${info.costHint ? `(${info.costHint})` : ''}`.trim();
    const testimonial = info.testimonials?.length ? randomItem(info.testimonials) : randomItem(TRUST_POOL);
    return { providerLine, testimonial };
  }
  const providerLine = 'Coordinamos tu envío por las flotas que salen a diario (Vaca Diez, Trans Pando, Cosmos, entre otras).';
  return { providerLine, testimonial: randomItem(TRUST_POOL) };
};
