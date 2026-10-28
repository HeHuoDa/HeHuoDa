import {
  extractAttachmentText,
  AttachmentParseError,
  type AttachmentMediaType,
} from "@hehuoda/sicau-connectors/notices";

const chunks: Buffer[] = [];
let size = 0;
for await (const chunk of process.stdin) {
  const buffer = Buffer.from(chunk);
  size += buffer.byteLength;
  if (size > 7 * 1024 * 1024) {
    process.stderr.write("attachment IPC input limit exceeded\n");
    process.exitCode = 2;
    break;
  }
  chunks.push(buffer);
}

if (!process.exitCode) {
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      bytes: string;
      mediaType: AttachmentMediaType;
    };
    const result = await extractAttachmentText(
      Buffer.from(input.bytes, "base64"),
      input.mediaType,
    );
    const output = JSON.stringify(result);
    if (Buffer.byteLength(output) > 1024 * 1024)
      throw new Error("attachment IPC output limit exceeded");
    process.stdout.write(output);
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        errorCode:
          error instanceof AttachmentParseError
            ? error.code
            : "invalid-document",
      }),
    );
  }
}
