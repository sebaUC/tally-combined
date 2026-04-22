/**
 * Smart emoji mapper — picks the most relevant emoji for a category name.
 * Uses keyword matching against a comprehensive map of iOS emojis.
 * Falls back to broad category detection, then a neutral default.
 */

const KEYWORD_MAP: [RegExp, string][] = [
  // Food & Drink
  [/almuerz|comida|restaur|cena|desayun|cocin|menú/i, '🍽️'],
  [/café|coffee|starbucks/i, '☕'],
  [/pizza/i, '🍕'],
  [/sushi|japon/i, '🍣'],
  [/hamburgues|burger|mcdon/i, '🍔'],
  [/cerve|beer|chela/i, '🍺'],
  [/vino|wine/i, '🍷'],
  [/trago|copete|bar|carrete|fiesta/i, '🍻'],
  [/frut|verdur|vegetal/i, '🥗'],
  [/pan|baker|pasteler/i, '🥖'],
  [/dulce|golosin|chocl|snack/i, '🍫'],
  [/helad|ice cream/i, '🍦'],
  [/super|mercad|provision|despensa/i, '🛒'],
  [/alimenta|grocer|feria/i, '🥬'],

  // Transport
  [/uber|didi|cabify|taxi|colectiv/i, '🚕'],
  [/bencin|gasolina|combustib|nafta/i, '⛽'],
  [/metro|tren|subte/i, '🚇'],
  [/bus|micro|locomoc/i, '🚌'],
  [/estaciona|parking|peaje|tag/i, '🅿️'],
  [/avión|vuelo|aéreo|aeropuert/i, '✈️'],
  [/biciclet|cicl/i, '🚲'],
  [/transport|movili/i, '🚗'],
  [/auto|vehícul|mantenci|mecánic|taller/i, '🔧'],

  // Home
  [/arriendo|alquiler|renta/i, '🏠'],
  [/luz|electric|enel|cgi/i, '💡'],
  [/agua|aguas andinas/i, '💧'],
  [/gas|calefacc/i, '🔥'],
  [/internet|wifi|fibra/i, '📶'],
  [/teléfon|celular|plan|entel|wom|claro|movistar/i, '📱'],
  [/mueble|decorac|hogar|casa/i, '🏡'],
  [/limpiez|aseo/i, '🧹'],

  // Health
  [/farmaci|remedi|medicament/i, '💊'],
  [/doctor|médic|consult|clínic/i, '🏥'],
  [/dentist|dent/i, '🦷'],
  [/psicólog|terap/i, '🧠'],
  [/gym|gimnasi|deport|ejercic|fitness/i, '💪'],
  [/salud|isapre|fonasa/i, '❤️‍🩹'],
  [/óptic|lente|anteojos/i, '👓'],

  // Education
  [/universid|u\b|facu/i, '🎓'],
  [/curs|clase|taller|capacit/i, '📖'],
  [/libr|lectur/i, '📚'],
  [/escuel|colegi/i, '🏫'],
  [/educac|estudi/i, '📝'],

  // Entertainment
  [/netflix|stream|hbo|disney|prime|crunchy/i, '📺'],
  [/spotify|music|apple music|deezer/i, '🎵'],
  [/cine|pelicul|movie/i, '🎬'],
  [/juego|gaming|gamer|playstation|xbox|nintendo|steam/i, '🎮'],
  [/concert|show|espectácul|evento/i, '🎤'],
  [/entreteni|ocio|diversi/i, '🎭'],

  // Personal
  [/ropa|vestir|zapatill|tienda/i, '👕'],
  [/peluquer|pelo|barber|corte/i, '💇'],
  [/cosmét|belleza|maquillaj/i, '💄'],
  [/mascot|perr|gat|veterinar/i, '🐾'],
  [/regalo|cumpleaño/i, '🎁'],
  [/personal|cuidado/i, '🧴'],

  // Work
  [/oficin|cowork|trabajo|pega/i, '💼'],
  [/freelanc|proyecto/i, '💻'],
  [/herramient|material|insumo/i, '🛠️'],

  // Finance
  [/segur|asegurad/i, '🛡️'],
  [/impuest|sii|contribuc/i, '🏛️'],
  [/invers|accion|fondo/i, '📈'],
  [/ahorr|reserv/i, '🐖'],
  [/deuda|préstam|crédito|cuota/i, '💳'],
  [/suscripc|membresi/i, '🔄'],
  [/comision|transfer/i, '🏦'],

  // Travel
  [/viaje|vacacion|turism/i, '✈️'],
  [/hotel|hostal|airbnb|alojamient/i, '🏨'],

  // Kids
  [/hijo|niñ|bebé|pañal|jardín infant/i, '👶'],
  [/colegi|escolar|útil/i, '✏️'],

  // Tech
  [/tecnolog|electrón|comput|pc|notebook/i, '💻'],
  [/app|software|digital/i, '📲'],

  // Misc
  [/donación|donacion|caridad|solidar/i, '❤️'],
  [/multa|infracción/i, '⚠️'],
  [/propina|tip/i, '💵'],
];

/**
 * Pick the best emoji for a category name.
 * Deterministic — no AI involved.
 */
export function pickCategoryEmoji(categoryName: string): string {
  for (const [pattern, emoji] of KEYWORD_MAP) {
    if (pattern.test(categoryName)) return emoji;
  }
  return '📌'; // Neutral default
}
