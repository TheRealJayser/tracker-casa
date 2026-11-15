// Dati iniziali importati dal foglio Google "To Buy List 🛍️" (15/11/2026).
// Usati una sola volta dal pannello Admin → "Importa dati dal foglio".

export const SEED_PEOPLE = [
  { id: "fede", name: "Fede", color: "#7c5cff", order: 1 },
  { id: "minkia", name: "Minkia", color: "#ff7a59", order: 2 },
  { id: "berta", name: "Berta", color: "#1fb58f", order: 3 }
];

// [id, nome, emoji, categoria]
export const SEED_PRODUCTS = [
  ["scottex", "Scottex", "🧻", "Pulizia"],
  ["carta-igienica", "Carta Igienica", "🧻", "Igiene"],
  ["spugna-piatti", "Spugna Piatti", "🧽", "Cucina"],
  ["detersivo-piatti", "Detersivo Piatti", "🫧", "Cucina"],
  ["dentifricio", "Dentifricio", "🪥", "Igiene"],
  ["sapone-mani", "Sapone Mani", "🧼", "Igiene"],
  ["sgrassatore", "Sgrassatore", "🧴", "Pulizia"],
  ["sacchetti-frigo", "Sacchetti Frigo", "🛍️", "Cucina"],
  ["pellicola", "Pellicola", "🌯", "Cucina"],
  ["alluminio", "Alluminio", "🥡", "Cucina"],
  ["carta-forno", "Carta Forno", "📜", "Cucina"],
  ["candeggina", "Candeggina", "🧪", "Pulizia"],
  ["detersivo-lavastoviglie", "Detersivo Lavastoviglie", "🍽️", "Pulizia"],
  ["cipolle", "Cipolle", "🧅", "Cibo"],
  ["patate", "Patate", "🥔", "Cibo"]
];

// Numero di "X" per persona e prodotto, nello stesso ordine di SEED_PRODUCTS.
export const SEED_COUNTS = {
  fede:   [2, 2, 1, 0, 3, 1, 0, 0, 1, 1, 0, 1, 1, 2, 4], // 19
  minkia: [2, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 2, 0, 3], // 11
  berta:  [2, 2, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3]  // 12
};
