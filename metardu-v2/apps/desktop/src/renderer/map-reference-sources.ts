import TileLayer from "ol/layer/Tile";
import TileWMS from "ol/source/TileWMS";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Style, Stroke, Fill } from "ol/style";

/**
 * A curated provider layer is an online visualization aid. It is deliberately
 * not an input to survey computation, a project asset, or a plan export.
 */
export interface PublicMapReferenceSource {
  id: string;
  title: string;
  jurisdiction: string;
  custodian: string;
  serviceUrl: string;
  serviceType: "WMS";
  layerName: string;
  license: string;
  attribution: string;
  providerPageUrl: string;
  refreshStatement: string;
  useLimit: string;
  projectStored: false;
  includedInExports: false;
  usableForSurveyComputation: false;
}

/**
 * First public-data pilot: the Netherlands' Kadaster cadastral boundary map.
 * The custodian describes this map as a reference and says it has no exact
 * boundary positions or dimensions. It is therefore visual-only in METARDU.
 */
export const NETHERLANDS_CADASTRAL_REFERENCE: PublicMapReferenceSource = Object.freeze({
  id: "nl-kadaster-cadastral-reference-v5",
  title: "Netherlands cadastral boundaries (reference)",
  jurisdiction: "Netherlands",
  custodian: "Kadaster, delivered via PDOK",
  serviceUrl: "https://service.pdok.nl/kadaster/brk-kadastrale-kaart/wms/v5_0",
  serviceType: "WMS",
  layerName: "KadastraleGrens",
  license: "CC BY; required credit: CC-BY Kadaster NL",
  attribution: "© Kadaster (CC-BY Kadaster NL), via PDOK",
  providerPageUrl: "https://www.pdok.nl/ogc-webservices/-/article/kadastrale-kaart",
  refreshStatement: "Kadaster reports daily currency for cadastral boundaries and parcel numbers; this WMS does not expose a per-feature timestamp.",
  useLimit: "Approximate map reference only. Do not derive exact boundary positions, dimensions, ownership, or survey control from this layer.",
  projectStored: false,
  includedInExports: false,
  usableForSurveyComputation: false,
});

export const NEW_ZEALAND_PRIMARY_PARCELS_REFERENCE = Object.freeze({
  id: "nz-linz-primary-parcels-reference-v1",
  title: "New Zealand primary parcels (reference)",
  jurisdiction: "New Zealand",
  custodian: "Toitū Te Whenua Land Information New Zealand (LINZ)",
  layerId: 50772,
  license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
  attribution: "© Toitū Te Whenua Land Information New Zealand (LINZ), CC BY 4.0",
  providerPageUrl: "https://data.linz.govt.nz/layer/50772-nz-primary-parcels/",
  sourceCrs: "EPSG:4167 (NZGD2000)",
  freshnessStatement: "LINZ publishes a current primary-parcel layer and revision history; check the source page for its latest update date.",
  useLimit: "Visual reference only. This primary-parcel layer is incomplete without non-primary parcels and has nominal positional accuracy ranging from 0.1–1 m in urban areas to 1–100 m in rural areas. Do not use it to establish legal boundaries, survey control, or design coordinates.",
  projectStored: false,
  includedInExports: false,
  usableForSurveyComputation: false,
});

export function createNetherlandsCadastralReferenceLayer(): TileLayer<TileWMS> {
  return new TileLayer({
    source: new TileWMS({
      url: NETHERLANDS_CADASTRAL_REFERENCE.serviceUrl,
      params: {
        LAYERS: NETHERLANDS_CADASTRAL_REFERENCE.layerName,
        VERSION: "1.3.0",
        FORMAT: "image/png",
        TRANSPARENT: true,
      },
      attributions: NETHERLANDS_CADASTRAL_REFERENCE.attribution,
      crossOrigin: "anonymous",
      transition: 0,
      tileLoadFunction: (tile, sourceUrl) => {
        const image = (tile as unknown as { getImage(): HTMLImageElement }).getImage();
        const failTile = () => image.dispatchEvent(new Event("error"));
        try {
          const request = new URL(sourceUrl);
          const bbox = request.searchParams.get("BBOX")?.split(",").map(Number);
          const width = Number(request.searchParams.get("WIDTH"));
          const height = Number(request.searchParams.get("HEIGHT"));
          if (!bbox || bbox.length !== 4 || bbox.some((value) => !Number.isFinite(value))) {
            failTile();
            return;
          }
          void window.metardu.publicMapReferences.fetchPdokTile({
            bbox3857: [bbox[0]!, bbox[1]!, bbox[2]!, bbox[3]!],
            width,
            height,
          }).then((bytes) => {
            const blobBytes = new ArrayBuffer(bytes.byteLength);
            new Uint8Array(blobBytes).set(bytes);
            const objectUrl = URL.createObjectURL(new Blob([blobBytes], { type: "image/png" }));
            const revoke = () => URL.revokeObjectURL(objectUrl);
            image.addEventListener("load", revoke, { once: true });
            image.addEventListener("error", revoke, { once: true });
            image.src = objectUrl;
          }).catch(failTile);
        } catch {
          failTile();
        }
      },
    }),
    visible: false,
    opacity: 0.9,
    zIndex: 1,
  });
}

export function createNewZealandPrimaryParcelsReferenceLayer(): VectorLayer<VectorSource> {
  return new VectorLayer({
    source: new VectorSource(),
    style: new Style({
      fill: new Fill({ color: "rgba(170, 95, 255, 0.035)" }),
      stroke: new Stroke({ color: "rgba(195, 130, 255, 0.85)", width: 1.25 }),
    }),
    visible: false,
    zIndex: 2,
  });
}
