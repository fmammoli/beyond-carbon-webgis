declare module "shpjs" {
  import type { FeatureCollection, GeoJsonProperties, Geometry } from "geojson";

  type ShapefileResult =
    | FeatureCollection<Geometry, GeoJsonProperties>
    | Array<FeatureCollection<Geometry, GeoJsonProperties>>;

  export default function shp(data: ArrayBuffer): Promise<ShapefileResult>;
}
