export type MapBiomasClass = {
  id: number;
  label: string;
  color: string;
};

// Class palette used in the legend panel.
export const MAPBIOMAS_CLASSES: MapBiomasClass[] = [
  { id: 3, label: "1.1 Forest Formation", color: "#1F8D49" },
  { id: 5, label: "1.2 Mangrove", color: "#04381D" },
  { id: 76, label: "1.3 Peat Swamp Forest", color: "#2F7360" },
  { id: 13, label: "2.1 Non-Forest Natural Vegetation", color: "#D89F5C" },
  { id: 40, label: "3.1 Rice Paddy", color: "#F272C2" },
  { id: 35, label: "3.2 Oil Palm", color: "#9065D0" },
  { id: 9, label: "3.3 Pulpwood Plantation", color: "#7A5900" },
  { id: 21, label: "3.4 Other Agriculture", color: "#FFEFC3" },
  { id: 30, label: "4.1 Mining Pit", color: "#9C0027" },
  { id: 24, label: "4.2 Urban Area", color: "#D4271E" },
  { id: 25, label: "4.3 Other Non-Vegetation", color: "#DB4D4F" },
  { id: 31, label: "5.1 Aquaculture", color: "#091077" },
  { id: 33, label: "5.2 River, Lake, Ocean", color: "#2532E4" },
  { id: 27, label: "6.0 Not Observed / Clouds", color: "#FFFFFF" },
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