/**
 * Semilla inicial del catálogo de merchants chilenos.
 *
 * Son 68 comercios migrados del catálogo chileno base.
 * Cubren el ~60-70% del volumen de transacciones de un chileno promedio.
 *
 * Reglas:
 *   - `name` es el canonical (Title Case). Usado también para el embedding.
 *   - `default_category` es el que se asigna cuando el usuario no tiene
 *     preferencia per-merchant registrada.
 *   - `website` (opcional): dominio sin http/www. Si está, el seed genera
 *     `logo_url = https://logo.clearbit.com/${website}`. Si no, logo_url = null.
 *   - `aliases` (opcional): variantes observables en strings de banco.
 *     Si se omite, el seed usa `[name.toUpperCase()]`.
 *
 * Expandir esta lista: agregar entradas y re-correr el seed (idempotente).
 */

export interface SeedMerchant {
  name: string;
  default_category: string;
  website?: string;
  aliases?: string[];
}

export const CATALOG_CL: SeedMerchant[] = [
  // Supermercados (7)
  { name: 'Lider',        default_category: 'Supermercado', website: 'lider.cl' },
  { name: 'Jumbo',        default_category: 'Supermercado', website: 'jumbo.cl' },
  { name: 'Unimarc',      default_category: 'Supermercado', website: 'unimarc.cl' },
  { name: 'Tottus',       default_category: 'Supermercado', website: 'tottus.cl' },
  { name: 'Ekono',        default_category: 'Supermercado', website: 'ekono.cl' },
  { name: 'Santa Isabel', default_category: 'Supermercado', website: 'santaisabel.cl' },
  { name: 'Alvi',         default_category: 'Supermercado', website: 'alvi.cl' },

  // Delivery (5)
  { name: 'Uber Eats',  default_category: 'Delivery', website: 'ubereats.com' },
  { name: 'Rappi',      default_category: 'Delivery', website: 'rappi.com' },
  { name: 'PedidosYa',  default_category: 'Delivery', website: 'pedidosya.cl' },
  { name: 'Justo',      default_category: 'Delivery', website: 'justo.cl' },
  { name: 'Cornershop', default_category: 'Delivery', website: 'cornershopapp.com' },

  // Transporte (4)
  { name: 'Uber',   default_category: 'Transporte', website: 'uber.com' },
  { name: 'DiDi',   default_category: 'Transporte', website: 'didiglobal.com' },
  { name: 'Cabify', default_category: 'Transporte', website: 'cabify.com' },
  { name: 'Bip!',   default_category: 'Transporte', website: 'tarjetabip.cl' },

  // Bencina (4)
  { name: 'Copec',     default_category: 'Bencina', website: 'copec.cl' },
  { name: 'Shell',     default_category: 'Bencina', website: 'shell.cl' },
  { name: 'Petrobras', default_category: 'Bencina', website: 'petrobras.cl' },
  { name: 'Enex',      default_category: 'Bencina', website: 'enex.cl' },

  // Café (3)
  { name: 'Starbucks',   default_category: 'Café', website: 'starbucks.cl' },
  { name: 'Juan Valdez', default_category: 'Café', website: 'juanvaldezcafe.com' },
  { name: 'Café Altura', default_category: 'Café' },

  // Comida rápida (6)
  { name: "McDonald's",  default_category: 'Comida rápida', website: 'mcdonalds.cl' },
  { name: 'Burger King', default_category: 'Comida rápida', website: 'burgerking.cl' },
  { name: 'KFC',         default_category: 'Comida rápida', website: 'kfc.cl' },
  { name: 'Subway',      default_category: 'Comida rápida', website: 'subway.com' },
  { name: "Domino's",    default_category: 'Comida rápida', website: 'dominos.cl' },
  { name: 'Pizza Hut',   default_category: 'Comida rápida', website: 'pizzahut.cl' },

  // Restaurante (1)
  { name: 'Pedro Juan y Diego', default_category: 'Restaurante' },

  // Suscripción (9)
  { name: 'Spotify',         default_category: 'Suscripción', website: 'spotify.com' },
  { name: 'Netflix',         default_category: 'Suscripción', website: 'netflix.com' },
  { name: 'Disney+',         default_category: 'Suscripción', website: 'disneyplus.com' },
  { name: 'HBO',             default_category: 'Suscripción', website: 'hbomax.com' },
  { name: 'Prime Video',     default_category: 'Suscripción', website: 'primevideo.com' },
  { name: 'Apple',           default_category: 'Suscripción', website: 'apple.com' },
  { name: 'YouTube Premium', default_category: 'Suscripción', website: 'youtube.com' },
  { name: 'ChatGPT',         default_category: 'Suscripción', website: 'openai.com' },
  { name: 'Claude',          default_category: 'Suscripción', website: 'claude.ai' },

  // Telefonía (4)
  { name: 'Entel',    default_category: 'Telefonía', website: 'entel.cl' },
  { name: 'Movistar', default_category: 'Telefonía', website: 'movistar.cl' },
  { name: 'WOM',      default_category: 'Telefonía', website: 'wom.cl' },
  { name: 'Claro',    default_category: 'Telefonía', website: 'claro.cl' },

  // Internet (3)
  { name: 'VTR',            default_category: 'Internet', website: 'vtr.cl' },
  { name: 'GTD',            default_category: 'Internet', website: 'gtd.cl' },
  { name: 'Mundo Pacífico', default_category: 'Internet', website: 'mundo.cl' },

  // Servicios (7)
  { name: 'Enel',          default_category: 'Servicios', website: 'enel.cl' },
  { name: 'Chilquinta',    default_category: 'Servicios', website: 'chilquinta.cl' },
  { name: 'Aguas Andinas', default_category: 'Servicios', website: 'aguasandinas.cl' },
  { name: 'Essbio',        default_category: 'Servicios', website: 'essbio.cl' },
  { name: 'Metrogas',      default_category: 'Servicios', website: 'metrogas.cl' },
  { name: 'Lipigas',       default_category: 'Servicios', website: 'lipigas.cl' },
  { name: 'Abastible',     default_category: 'Servicios', website: 'abastible.cl' },

  // Retail (6)
  { name: 'Falabella',     default_category: 'Retail', website: 'falabella.com' },
  { name: 'Ripley',        default_category: 'Retail', website: 'ripley.cl' },
  { name: 'Paris',         default_category: 'Retail', website: 'paris.cl' },
  { name: 'Mercado Libre', default_category: 'Retail', website: 'mercadolibre.cl' },
  { name: 'La Polar',      default_category: 'Retail', website: 'lapolar.cl' },
  { name: 'Hites',         default_category: 'Retail', website: 'hites.com' },

  // Hogar (3)
  { name: 'IKEA',    default_category: 'Hogar', website: 'ikea.com' },
  { name: 'Sodimac', default_category: 'Hogar', website: 'sodimac.cl' },
  { name: 'Easy',    default_category: 'Hogar', website: 'easy.cl' },

  // Salud (3)
  { name: 'Cruz Verde',        default_category: 'Salud', website: 'cruzverde.cl' },
  { name: 'Farmacias Ahumada', default_category: 'Salud', website: 'farmaciasahumada.cl' },
  { name: 'Salcobrand',        default_category: 'Salud', website: 'salcobrand.cl' },

  // Tecnología (3)
  { name: 'Apple Store', default_category: 'Tecnología', website: 'apple.com' },
  { name: 'PC Factory',  default_category: 'Tecnología', website: 'pcfactory.cl' },
  { name: 'SP Digital',  default_category: 'Tecnología', website: 'spdigital.cl' },
];
