/**
 * Minimal type declarations for `word-extractor`, which ships without its own.
 * Only the surface we use (extracting the body text of a legacy .doc) is typed.
 */
declare module "word-extractor" {
  interface Document {
    getBody(): string;
    getFootnotes(): string;
    getHeaders(): string;
    getFooters(): string;
    getEndnotes(): string;
    getAnnotations(): string;
  }

  export default class WordExtractor {
    extract(source: string | Buffer): Promise<Document>;
  }
}
