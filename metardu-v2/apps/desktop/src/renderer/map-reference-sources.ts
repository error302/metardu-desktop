import TileLayer from "ol/layer/Tile";
import TileWMS from "ol/source/TileWMS";

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
    }),
    visible: false,
    opacity: 0.9,
    zIndex: 1,
  });
}
