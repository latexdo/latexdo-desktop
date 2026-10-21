import { Blob as NodeBlob } from "node:buffer";
import { deflateSync, deflateRawSync } from "node:zlib";
import { DecompressionStream } from "node:stream/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { convertDrawioToTikz } from "./drawioToTikz";
const model =
  '<mxGraphModel pageWidth="400" pageHeight="300"><root><mxCell id="a" value="Hello" vertex="1"><mxGeometry x="0" y="0" width="100" height="50"/></mxCell></root></mxGraphModel>';
const wrap = (text: string) =>
  `<mxfile><diagram name="Encoded">${text}</diagram></mxfile>`;
afterEach(() => vi.unstubAllGlobals());
describe("draw.io encoded diagrams", () => {
  it.each([model, encodeURIComponent(model)])(
    "accepts textual diagram XML",
    async (text) => {
      const result = await convertDrawioToTikz(wrap(`<![CDATA[${text}]]>`));
      expect(result.pageName).toBe("Encoded");
      expect(result.shapeCount).toBe(1);
      expect(result.code).toContain("Hello");
    },
  );
  it.each([deflateRawSync, deflateSync])(
    "inflates compressed diagram XML",
    async (compress) => {
      vi.stubGlobal("Blob", NodeBlob);
      vi.stubGlobal("DecompressionStream", DecompressionStream);
      const result = await convertDrawioToTikz(
        wrap(compress(encodeURIComponent(model)).toString("base64")),
      );
      expect(result.shapeCount).toBe(1);
      expect(result.code).toContain("Hello");
    },
  );
  it("accepts compressed XML containing a literal percent", async () => {
    vi.stubGlobal("Blob", NodeBlob);
    vi.stubGlobal("DecompressionStream", DecompressionStream);
    const result = await convertDrawioToTikz(
      wrap(deflateSync(model.replace("Hello", "100% ready")).toString("base64")),
    );
    expect(result.code).toContain("100\\% ready");
  });
  it("reports unsupported decompression and corrupt payloads", async () => {
    vi.stubGlobal("DecompressionStream", undefined);
    await expect(convertDrawioToTikz(wrap(""))).rejects.toThrow("uncompressed XML");
    vi.stubGlobal("Blob", NodeBlob);
    vi.stubGlobal("DecompressionStream", DecompressionStream);
    await expect(convertDrawioToTikz(wrap("YWJj"))).rejects.toThrow("Could not decode");
    await expect(
      convertDrawioToTikz(wrap(deflateSync("<other/>").toString("base64"))),
    ).rejects.toThrow("mxGraphModel");
  });
  it("rejects malformed XML and documents without diagrams", async () => {
    await expect(convertDrawioToTikz("<mxfile>")).rejects.toThrow("valid XML");
    await expect(convertDrawioToTikz("<mxfile/>")).rejects.toThrow(
      "does not contain a diagram",
    );
  });
  it("ignores zero-size vertices and dangling edges", async () => {
    const result = await convertDrawioToTikz(
      '<mxGraphModel><root><mxCell vertex="1"><mxGeometry width="bad" height="0"/></mxCell><mxCell edge="1" source="missing"/></root></mxGraphModel>',
    );
    expect(result.shapeCount).toBe(0);
    expect(result.code).not.toContain("\\draw");
  });
  it.each([
    ["classic", "classic", "<->"],
    ["classic", "none", "<-"],
  ])("preserves connector arrows and explicit waypoints", async (start, end, arrow) => {
    const result = await convertDrawioToTikz(
      `<mxGraphModel><root><mxCell vertex="1" style="strokeColor=#000000;fillColor=#ffffff;dashed=1"><mxGeometry width="100" height="50"/></mxCell><mxCell edge="1" style="startArrow=${start};endArrow=${end};strokeWidth=2;dashed=1"><mxGeometry><mxPoint as="sourcePoint" x="0" y="0"/><Array as="points"><mxPoint x="50" y="30"/></Array><mxPoint as="targetPoint" x="100" y="100"/></mxGeometry></mxCell></root></mxGraphModel>`,
    );
    expect(result.code).toContain(`\\draw[${arrow}`);
    expect(result.code).toContain("line width=1.5pt");
    expect(result.code).toContain("dashed");
    expect(result.code).toContain("draw=black");
    expect(result.code).toContain("fill=white");
  });
});
