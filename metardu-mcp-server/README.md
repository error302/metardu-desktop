# MetaRDU MCP Server

MCP (Model Context Protocol) server exposing the MetaRDU surveying engine as tools for LLM-assisted survey computation.

## Tools (10 total)

### COGO (Coordinate Geometry)
| Tool | Description |
|------|-------------|
| `metardu_cogo_radiation` | Polar to rectangular — compute point from station, bearing, distance |
| `metardu_cogo_bb_intersection` | Bearing-bearing intersection from two stations |
| `metardu_cogo_dd_intersection` | Distance-distance intersection (two circles) |
| `metardu_cogo_line_offset` | Perpendicular offset from a line |
| `metardu_cogo_area` | Polygon area and perimeter (Shoelace formula) |

### Fee Estimation
| Tool | Description |
|------|-------------|
| `metardu_fee_estimate` | Compute statutory surveyor fees for 8 countries |
| `metardu_fee_list_countries` | List available countries and fee scales |

### Contour Generation
| Tool | Description |
|------|-------------|
| `metardu_contour_generate` | Generate contour lines from point clouds (Delaunay + marching triangles) |

### Survey Type Detection
| Tool | Description |
|------|-------------|
| `metardu_survey_detect_type` | Classify a survey project from text description |
| `metardu_survey_list_types` | List all supported survey types |

## Setup

```bash
npm install
npm run build
```

## Running

```bash
# stdio transport (default)
node dist/index.js

# development with auto-reload
npm run dev
```

## Configuration

Add to your MCP client (e.g. Claude Desktop):

```json
{
  "mcpServers": {
    "metardu": {
      "command": "node",
      "args": ["/path/to/metardu-mcp-server/dist/index.js"]
    }
  }
}
```

## Supported Countries (Fee Estimation)

| Code | Country | Currency | Regulatory Body |
|------|---------|----------|-----------------|
| KE | Kenya | KES | ISK (Survey Act Cap. 299) |
| AU | Australia | AUD | AICPS |
| GB | United Kingdom | GBP | RICS |
| ZA | South Africa | ZAR | SACNASP |
| AE | UAE | AED | Dubai Municipality |
| DE | Germany | EUR | HOAI |
| US | United States | USD | NSPS (ALTA/NSPS) |
| GH | Ghana | GHS | GhIS (Land Act 2020) |
