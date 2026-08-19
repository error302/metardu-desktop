#!/usr/bin/env node
/**
 * MetaRDU MCP Server
 *
 * Exposes the MetaRDU surveying engine as MCP tools:
 *   - COGO: radiation, bearing-bearing intersection, distance-distance intersection, line offset, area
 *   - Fee estimation: multi-country statutory surveyor fees
 *   - Contour generation: Delaunay TIN + marching triangles from point clouds
 *   - Survey type detection: classify survey projects from keywords
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCogoTools } from "./tools/cogo.js";
import { registerFeeTools } from "./tools/fees.js";
import { registerContourTools } from "./tools/contours.js";
import { registerSurveyTypeTools } from "./tools/survey-type.js";

const server = new McpServer({
  name: "metardu-mcp-server",
  version: "1.0.0",
});

registerCogoTools(server);
registerFeeTools(server);
registerContourTools(server);
registerSurveyTypeTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("metardu-mcp-server running via stdio");
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
