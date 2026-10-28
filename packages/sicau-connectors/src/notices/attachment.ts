import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Entry } from "yauzl";

const require = createRequire(import.meta.url);
const yauzl = require("yauzl") as typeof import("yauzl");
const mammoth = require("mammoth") as typeof import("mammoth");

export const attachmentExtractorVersion = "sicau-attachment-text/1";
export type AttachmentMediaType =
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export type AttachmentSegment = {
  kind: "page" | "paragraph";
  index: number;
  text: string;
};
export interface AttachmentParseLimits {
  maxInputBytes: number;
  maxPdfPages: number;
  maxDocxExpandedBytes: number;
  maxArchiveMembers: number;
  maxTextBytes: number;
}
export const defaultAttachmentLimits: AttachmentParseLimits = {
  maxInputBytes: 5 * 1024 * 1024,
  maxPdfPages: 100,
  maxDocxExpandedBytes: 20 * 1024 * 1024,
  maxArchiveMembers: 256,
  maxTextBytes: 1024 * 1024,
};
export class AttachmentParseError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const forbiddenListWords =
  /报名(?:者|人员|学生)?(?:信息|名单|汇总)|参赛(?:者|人员|学生)?名单|获奖名单|晋级名单|入围名单|身份证号|联系方式/;
export type AttachmentEligibility = "eligible" | "blocked" | "manual";
export function attachmentEligibility(
  title: string,
  contextText: string,
): AttachmentEligibility {
  if (forbiddenListWords.test(title) || forbiddenListWords.test(contextText))
    return "blocked";
  if (
    /竞赛|比赛|大赛|挑战杯|创新创业|互联网\s*\+/.test(
      `${title} ${contextText}`,
    ) &&
    /规则|章程|通知|方案|指南|细则|办法|要求/.test(`${title} ${contextText}`)
  )
    return "eligible";
  return "manual";
}

function containsApplicantContent(text: string): boolean {
  if (forbiddenListWords.test(text)) return true;
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let identityRows = 0;
  for (const line of lines) {
    if (/(?:学号|学生编号)\s*[:：]?\s*\d{8,16}/.test(line)) identityRows++;
    else if (
      /(?:姓名|学生)\s*[:：]\s*[\u4e00-\u9fff]{2,4}/.test(line) &&
      /\d{8,16}/.test(line)
    )
      identityRows++;
  }
  return identityRows >= 2;
}

const docxMediaType =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const;

/** 仅以内容签名识别类型；Content-Type 只用于调用方审计，不参与信任判断。 */
export function classifyAttachment(
  bytes: Uint8Array,
  contentType = "",
): AttachmentMediaType | null {
  const declaredType = contentType.split(";", 1)[0].trim().toLowerCase();
  if (
    bytes.byteLength >= 5 &&
    Buffer.from(bytes.subarray(0, 5)).toString() === "%PDF-" &&
    ["application/pdf", "application/octet-stream"].includes(declaredType)
  )
    return "application/pdf";
  if (bytes.byteLength >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const signature = inspectDocxSignature(bytes);
    if (
      signature &&
      [docxMediaType, "application/octet-stream"].includes(declaredType)
    )
      return docxMediaType;
  }
  return null;
}

function inspectDocxSignature(bytes: Uint8Array): boolean {
  // DOCX is an OPC ZIP package. Inspect central directory names without inflating data.
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > buffer.length) return false;
  const count = buffer.readUInt16LE(eocd + 10);
  const size = buffer.readUInt32LE(eocd + 12);
  const offset = buffer.readUInt32LE(eocd + 16);
  if (count < 2 || count > 256 || offset + size > eocd) return false;
  let cursor = offset;
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > eocd || buffer.readUInt32LE(cursor) !== 0x02014b50)
      return false;
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    if (cursor + 46 + nameLength + extraLength + commentLength > eocd)
      return false;
    names.add(buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return names.has("[Content_Types].xml") && names.has("word/document.xml");
}

function inspectDocxArchive(bytes: Buffer, limits: AttachmentParseLimits) {
  return new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(
      bytes,
      { lazyEntries: true, validateEntrySizes: true, decodeStrings: true },
      (openError, archive) => {
        if (openError || !archive) {
          reject(new AttachmentParseError("invalid-docx", "DOCX压缩包无效"));
          return;
        }
        let members = 0;
        let expanded = 0;
        let hasDocument = false;
        let hasContentTypes = false;
        let settled = false;
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          archive.close();
          reject(error);
        };
        archive.on("error", (error: Error) => fail(error));
        archive.on("end", () => {
          if (settled) return;
          settled = true;
          if (!hasDocument || !hasContentTypes) {
            reject(
              new AttachmentParseError("invalid-docx", "DOCX缺少必要文档部件"),
            );
            return;
          }
          resolve();
        });
        archive.on("entry", (entry: Entry) => {
          members++;
          if (members > limits.maxArchiveMembers)
            return fail(
              new AttachmentParseError(
                "archive-member-limit",
                "DOCX部件数量超限",
              ),
            );
          if (entry.isEncrypted())
            return fail(
              new AttachmentParseError("encrypted-docx", "加密DOCX需人工核对"),
            );
          if (
            entry.fileName.includes("\\") ||
            entry.fileName.startsWith("/") ||
            entry.fileName.split("/").includes("..")
          )
            return fail(
              new AttachmentParseError(
                "unsafe-archive-path",
                "DOCX部件路径无效",
              ),
            );
          if (entry.uncompressedSize + expanded > limits.maxDocxExpandedBytes)
            return fail(
              new AttachmentParseError(
                "expanded-size-limit",
                "DOCX解压体积超限",
              ),
            );
          hasDocument ||= entry.fileName === "word/document.xml";
          hasContentTypes ||= entry.fileName === "[Content_Types].xml";
          archive.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream)
              return fail(
                new AttachmentParseError("invalid-docx", "读取DOCX部件失败"),
              );
            let actual = 0;
            stream.on("data", (chunk: Buffer) => {
              actual += chunk.byteLength;
              expanded += chunk.byteLength;
              if (expanded > limits.maxDocxExpandedBytes) {
                stream.destroy();
                fail(
                  new AttachmentParseError(
                    "expanded-size-limit",
                    "DOCX实际解压体积超限",
                  ),
                );
              }
            });
            stream.on("error", () =>
              fail(
                new AttachmentParseError("invalid-docx", "解压DOCX部件失败"),
              ),
            );
            stream.on("end", () => {
              if (actual !== entry.uncompressedSize)
                return fail(
                  new AttachmentParseError(
                    "invalid-docx",
                    "DOCX部件大小不匹配",
                  ),
                );
              archive.readEntry();
            });
          });
        });
        archive.readEntry();
      },
    );
  });
}

async function parsePdf(
  bytes: Uint8Array,
  limits: AttachmentParseLimits,
): Promise<AttachmentSegment[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfRoot = dirname(require.resolve("pdfjs-dist/package.json"));
  const task = getDocument({
    data: new Uint8Array(bytes),
    verbosity: 0,
    isEvalSupported: false,
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    disableAutoFetch: true,
    disableStream: true,
    stopAtErrors: true,
    standardFontDataUrl:
      join(pdfRoot, "standard_fonts").replaceAll("\\", "/") + "/",
    cMapUrl: join(pdfRoot, "cmaps").replaceAll("\\", "/") + "/",
    cMapPacked: true,
  });
  try {
    const document = await task.promise;
    if (document.numPages > limits.maxPdfPages)
      throw new AttachmentParseError("page-limit", "PDF页数超过100页");
    const segments: AttachmentSegment[] = [];
    let textBytes = 0;
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .filter(Boolean)
        .join(" ")
        .trim();
      textBytes += Buffer.byteLength(text);
      if (textBytes > limits.maxTextBytes)
        throw new AttachmentParseError("text-size-limit", "PDF提取文本超限");
      segments.push({ kind: "page", index, text });
    }
    if (!segments.some((segment) => segment.text))
      throw new AttachmentParseError(
        "no-text-layer",
        "PDF无可提取文字，可能为扫描件",
      );
    return segments;
  } finally {
    await task.destroy();
  }
}

async function parseDocx(
  bytes: Uint8Array,
  limits: AttachmentParseLimits,
): Promise<AttachmentSegment[]> {
  const buffer = Buffer.from(bytes);
  await inspectDocxArchive(buffer, limits);
  const result = await mammoth.extractRawText({ buffer });
  if (Buffer.byteLength(result.value) > limits.maxTextBytes)
    throw new AttachmentParseError("text-size-limit", "DOCX提取文本超限");
  const paragraphs = result.value
    .split(/\r?\n\s*\r?\n/)
    .map((text: string) => text.trim())
    .filter(Boolean);
  if (!paragraphs.length)
    throw new AttachmentParseError("no-text-layer", "DOCX无可提取文字");
  return paragraphs.map((text: string, index: number) => ({
    kind: "paragraph",
    index: index + 1,
    text,
  }));
}

export async function extractAttachmentText(
  bytes: Uint8Array,
  mediaType: AttachmentMediaType,
  limits: AttachmentParseLimits = defaultAttachmentLimits,
): Promise<{
  mediaType: AttachmentMediaType;
  extractorVersion: string;
  status: "extracted" | "blocked";
  segments: AttachmentSegment[];
  errorCode?: string;
}> {
  if (bytes.byteLength > limits.maxInputBytes)
    throw new AttachmentParseError("input-size-limit", "附件超过5MiB下载上限");
  const detected = classifyAttachment(bytes, mediaType);
  if (detected !== mediaType)
    throw new AttachmentParseError("type-mismatch", "附件签名与声明类型不一致");
  const segments =
    mediaType === "application/pdf"
      ? await parsePdf(bytes, limits)
      : await parseDocx(bytes, limits);
  if (containsApplicantContent(segments.map(({ text }) => text).join("\n")))
    return {
      mediaType,
      extractorVersion: attachmentExtractorVersion,
      status: "blocked",
      segments: [],
      errorCode: "applicant-list",
    };
  return {
    mediaType,
    extractorVersion: attachmentExtractorVersion,
    status: "extracted",
    segments,
  };
}
