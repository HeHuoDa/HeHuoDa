import { deflateRawSync } from "node:zlib";
import {
  classifyAttachment,
  extractAttachmentText,
  attachmentEligibility,
} from "../dist/notices/index.js";

function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const filename = Buffer.from(name);
    const content = Buffer.from(value);
    const compressed = deflateRawSync(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, filename);
    offset += local.length + filename.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}

describe("官方通知附件识别与文本提取", () => {
  it.each(["竞赛个人资料.pdf", "比赛学生明细.docx", "参赛清单.pdf"])(
    "个人资料类标题禁止下载：%s",
    (title) => {
      expect(attachmentEligibility(title, "比赛报名规则")).toBe("blocked");
    },
  );
  it("中文文字 PDF 按页定位，页数和输入体积限制可触发", async () => {
    const cmap =
      "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Test def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange 2 beginbfchar <01> <6BD4> <02> <8D5B> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end";
    const stream = "BT /F1 12 Tf 10 100 Td <0102> Tj ET";
    const buildPdf = (
      pageCount: number,
      text = stream,
      blankLast = false,
      encrypted = false,
    ) => {
      const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, i) => (blankLast && i === pageCount - 1 ? "7 0 R" : "3 0 R")).join(" ")}] /Count ${pageCount} >>`,
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 6 0 R >>",
        `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
        `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`,
      ];
      if (blankLast)
        objects.push(
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 8 0 R >>",
          "<< /Length 0 >>\nstream\n\nendstream",
        );
      if (encrypted)
        objects.push(
          "<< /Filter /Standard /V 1 /R 2 /Length 40 /O <" +
            "00".repeat(32) +
            "> /U <" +
            "00".repeat(32) +
            "> /P -4 >>",
        );
      let pdf = "%PDF-1.4\n";
      const offsets = [0];
      for (const [i, object] of objects.entries()) {
        offsets.push(pdf.length);
        pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
      }
      const xref = pdf.length;
      pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => String(offset).padStart(10, "0") + " 00000 n ")
        .join(
          "\n",
        )}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${encrypted ? "/Encrypt 7 0 R /ID [<" + "00".repeat(16) + "><" + "00".repeat(16) + ">]" : ""} >>\nstartxref\n${xref}\n%%EOF`;
      return Buffer.from(pdf);
    };
    const bytes = buildPdf(1);
    expect(
      (await extractAttachmentText(bytes, "application/pdf")).segments,
    ).toEqual([{ kind: "page", index: 1, text: "比赛" }]);
    await expect(
      extractAttachmentText(bytes, "application/pdf", {
        maxInputBytes: bytes.length - 1,
        maxPdfPages: 100,
        maxDocxExpandedBytes: 20 * 1024 * 1024,
        maxArchiveMembers: 256,
        maxTextBytes: 1024 * 1024,
      }),
    ).rejects.toThrow("5MiB");
    await expect(
      extractAttachmentText(bytes, "application/pdf", {
        maxInputBytes: 5 * 1024 * 1024,
        maxPdfPages: 0,
        maxDocxExpandedBytes: 20 * 1024 * 1024,
        maxArchiveMembers: 256,
        maxTextBytes: 1024 * 1024,
      }),
    ).rejects.toThrow("100页");
    expect(
      (await extractAttachmentText(buildPdf(100), "application/pdf")).segments,
    ).toHaveLength(100);
    await expect(
      extractAttachmentText(buildPdf(101), "application/pdf"),
    ).rejects.toThrow("100页");
    await expect(
      extractAttachmentText(buildPdf(1, ""), "application/pdf"),
    ).rejects.toThrow("无可提取文字");
    await expect(
      extractAttachmentText(buildPdf(2, stream, true), "application/pdf"),
    ).rejects.toThrow("文字");
    await expect(
      extractAttachmentText(
        buildPdf(1, stream, false, true),
        "application/pdf",
      ),
    ).rejects.toMatchObject({ code: "encrypted-pdf" });
    await expect(
      extractAttachmentText(
        Buffer.alloc(5 * 1024 * 1024 + 1),
        "application/pdf",
      ),
    ).rejects.toThrow("5MiB");
  });
  it("只按真实PDF签名识别，不信URL或声明类型", () => {
    expect(
      classifyAttachment(
        Buffer.from("%PDF-1.7\n"),
        "application/pdf; version=1.7",
      ),
    ).toBe("application/pdf");
    expect(
      classifyAttachment(Buffer.from("%PDF-1.7\n"), "text/html"),
    ).toBeNull();
    expect(
      classifyAttachment(Buffer.from("%PDF-1.7\n"), "application/octet-stream"),
    ).toBe("application/pdf");
    expect(
      classifyAttachment(Buffer.from("<html>login</html>"), "application/pdf"),
    ).toBeNull();
  });

  it("名单优先阻止下载，只有明确规则型赛事文档自动处理", () => {
    expect(attachmentEligibility("竞赛报名名单.pdf", "竞赛通知规则")).toBe(
      "blocked",
    );
    expect(
      attachmentEligibility("报名须知.pdf", "互联网+比赛报名通知及参赛规则"),
    ).toBe("eligible");
    expect(attachmentEligibility("通知附件.pdf", "其他内容")).toBe("manual");
  });

  it("无效、加密与扫描PDF不会作为完整文字证据", async () => {
    await expect(
      extractAttachmentText(Buffer.from("nope"), "application/pdf"),
    ).rejects.toThrow();
    await expect(
      extractAttachmentText(Buffer.from("%PDF-1.7\n"), "application/pdf"),
    ).rejects.toThrow();
  });

  it("DOCX从实际ZIP的段落读取中文纯文本并保留稳定段落号", async () => {
    const docx = zip({
      "[Content_Types].xml":
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
      "word/document.xml":
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>比赛章程与报名规则</w:t></w:r></w:p><w:p><w:r><w:t>截止时间为六月三十日</w:t></w:r></w:p><w:sectPr/></w:body></w:document>',
    });
    expect(
      classifyAttachment(
        docx,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    const result = await extractAttachmentText(
      docx,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(result.segments).toEqual([
      { kind: "paragraph", index: 1, text: "比赛章程与报名规则" },
      { kind: "paragraph", index: 2, text: "截止时间为六月三十日" },
    ]);
  });

  it("DOCX表格文字按段落定位，含未覆盖的页眉时转人工", async () => {
    const mediaType =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const files = {
      "[Content_Types].xml": "<Types/>",
      "word/document.xml":
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>比赛规则</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格资格要求</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
    };
    expect(
      (await extractAttachmentText(zip(files), mediaType)).segments,
    ).toEqual([
      { kind: "paragraph", index: 1, text: "比赛规则" },
      { kind: "paragraph", index: 2, text: "表格资格要求" },
    ]);
    await expect(
      extractAttachmentText(
        zip({ ...files, "word/header1.xml": "<header>仅限大三学生</header>" }),
        mediaType,
      ),
    ).rejects.toThrow("页眉");
  });
  it("DOCX中疑似名单内容在输出前清空，实际解压大小超限拒绝", async () => {
    const mediaType =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const docx = zip({
      "[Content_Types].xml": "<Types/>",
      "word/document.xml":
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>学号:202500000001 姓名:张三</w:t></w:r></w:p><w:p><w:r><w:t>学号:202500000002 姓名:李四</w:t></w:r></w:p></w:body></w:document>',
    });
    const roster = await extractAttachmentText(docx, mediaType);
    expect(roster).toMatchObject({
      status: "blocked",
      segments: [],
      errorCode: "applicant-list",
    });
    await expect(
      extractAttachmentText(docx, mediaType, {
        maxInputBytes: 5 * 1024 * 1024,
        maxPdfPages: 100,
        maxDocxExpandedBytes: 32,
        maxArchiveMembers: 256,
        maxTextBytes: 1024 * 1024,
      }),
    ).rejects.toThrow("体积超限");
  });
});
