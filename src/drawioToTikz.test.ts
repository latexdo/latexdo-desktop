import { describe, expect, it } from "vitest";
import { convertDrawioToTikz } from "./drawioToTikz";

const sampleDrawio = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile>
  <diagram id="page-1" name="Pipeline">
    <mxGraphModel pageWidth="400" pageHeight="300">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="start" value="Start &amp;amp; Validate" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
          <mxGeometry x="40" y="40" width="120" height="60" as="geometry"/>
        </mxCell>
        <mxCell id="decision" value="A_B" style="rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;" vertex="1" parent="1">
          <mxGeometry x="220" y="40" width="80" height="80" as="geometry"/>
        </mxCell>
        <mxCell id="edge-1" value="yes" style="endArrow=classic;html=1;rounded=0;strokeColor=#6c8ebf;" edge="1" parent="1" source="start" target="decision">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

describe("convertDrawioToTikz", () => {
  it("converts draw.io shapes, labels, colors, and connectors into TikZ", async () => {
    const conversion = await convertDrawioToTikz(sampleDrawio);

    expect(conversion).toMatchObject({
      pageName: "Pipeline",
      shapeCount: 2,
      connectorCount: 1,
      labelCount: 3,
    });
    expect(conversion.code).toContain("\\begin{tikzpicture}");
    expect(conversion.code).toContain("\\definecolor{drawioFilldae8fc}");
    expect(conversion.code).toContain("Start \\& Validate");
    expect(conversion.code).toContain("A\\_B");
    expect(conversion.code).toContain(" -- cycle;");
    expect(conversion.code).toContain("\\draw[->");
    expect(conversion.code).toContain("{yes}");
  });

  it("accepts a raw mxGraphModel document", async () => {
    const conversion = await convertDrawioToTikz(`
      <mxGraphModel pageWidth="200" pageHeight="200">
        <root>
          <mxCell id="0"/>
          <mxCell id="1" parent="0"/>
          <mxCell id="note" value="Only text" style="text;html=1;strokeColor=none;fillColor=none;" vertex="1" parent="1">
            <mxGeometry x="20" y="20" width="100" height="30" as="geometry"/>
          </mxCell>
        </root>
      </mxGraphModel>
    `);

    expect(conversion.shapeCount).toBe(1);
    expect(conversion.connectorCount).toBe(0);
    expect(conversion.code).toContain("\\node[align=center]");
    expect(conversion.code).toContain("Only text");
  });
});
