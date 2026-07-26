export type MapBiomasClass = {
  id: number;
  label: string;
  labelId: string;
  color: string;
};

// Class palette used in the legend panel.
export const MAPBIOMAS_CLASSES: MapBiomasClass[] = [
  { id: 3, label: "1.1 Forest Formation", labelId: "1.1 Hutan", color: "#1F8D49" },
  { id: 5, label: "1.2 Mangrove", labelId: "1.2 Mangrove", color: "#04381D" },
  { id: 76, label: "1.3 Peat Swamp Forest", labelId: "1.3 Hutan Rawa Gambut", color: "#2F7360" },
  { id: 13, label: "2.1 Non-Forest Natural Vegetation", labelId: "2.1 Vegetasi Alami Non-Hutan", color: "#D89F5C" },
  { id: 40, label: "3.1 Rice Paddy", labelId: "3.1 Sawah", color: "#F272C2" },
  { id: 35, label: "3.2 Oil Palm", labelId: "3.2 Kelapa Sawit", color: "#9065D0" },
  { id: 9, label: "3.3 Pulpwood Plantation", labelId: "3.3 Hutan Tanaman Kayu", color: "#7A5900" },
  { id: 21, label: "3.4 Other Agriculture", labelId: "3.4 Pertanian Lainnya", color: "#FFEFC3" },
  { id: 30, label: "4.1 Mining Pit", labelId: "4.1 Area Tambang", color: "#9C0027" },
  { id: 24, label: "4.2 Urban Area", labelId: "4.2 Kawasan Perkotaan", color: "#D4271E" },
  { id: 25, label: "4.3 Other Non-Vegetation", labelId: "4.3 Non-Vegetasi Lainnya", color: "#DB4D4F" },
  { id: 31, label: "5.1 Aquaculture", labelId: "5.1 Akuakultur", color: "#091077" },
  { id: 33, label: "5.2 River, Lake, Ocean", labelId: "5.2 Sungai, Danau, Laut", color: "#2532E4" },
  { id: 27, label: "6.0 Not Observed / Clouds", labelId: "6.0 Tidak Teramati / Awan", color: "#FFFFFF" },
];

export const MAPBIOMAS_CLASS_LOOKUP = Object.fromEntries(
  MAPBIOMAS_CLASSES.map((item) => [item.id, item]),
);

function hexToRgb(hex: string): [number, number, number] {
  const sanitized = hex.replace("#", "");
  const red = Number.parseInt(sanitized.slice(0, 2), 16);
  const green = Number.parseInt(sanitized.slice(2, 4), 16);
  const blue = Number.parseInt(sanitized.slice(4, 6), 16);
  return [red, green, blue];
}

export const MAPBIOMAS_CLASS_COLOR_RGB_LOOKUP: Record<number, [number, number, number]> =
  Object.fromEntries(MAPBIOMAS_CLASSES.map((item) => [item.id, hexToRgb(item.color)]));