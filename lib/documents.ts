/**
 * Shared (client + server safe) helpers describing which document formats can
 * be uploaded. Keep this free of server-only imports so the upload UI can use
 * the same definitions the server validates against.
 */

export type SupportedExtension = ".pdf" | ".txt" | ".doc" | ".docx";

/** Extension -> the content type we store the object with. */
export const CONTENT_TYPE_BY_EXTENSION: Record<SupportedExtension, string> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export const SUPPORTED_EXTENSIONS = Object.keys(
  CONTENT_TYPE_BY_EXTENSION
) as SupportedExtension[];

/** `accept` attribute value for the file input. */
export const UPLOAD_ACCEPT = [
  ...SUPPORTED_EXTENSIONS,
  ...Object.values(CONTENT_TYPE_BY_EXTENSION),
].join(",");

/** Human-readable list for prompts and error messages, e.g. "PDF, TXT, DOC…". */
export const SUPPORTED_LABEL = SUPPORTED_EXTENSIONS.map((e) =>
  e.slice(1).toUpperCase()
).join(", ");

/** Lower-cased extension (including the dot) of a file name, or "" if none. */
export function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot).toLowerCase();
}

export function getSupportedExtension(
  fileName: string
): SupportedExtension | null {
  const ext = getExtension(fileName);
  return (SUPPORTED_EXTENSIONS as string[]).includes(ext)
    ? (ext as SupportedExtension)
    : null;
}

/**
 * A file is accepted if its extension is supported. We key off the extension
 * rather than `file.type` because browsers report MIME types inconsistently
 * (and often leave it empty for `.doc`).
 */
export function isSupportedDocument(fileName: string): boolean {
  return getSupportedExtension(fileName) !== null;
}
