import { ParseResult, SupportedFormat } from '@/types/importer';

export interface Parser {
  format: SupportedFormat;
  label: string;
  extensions: string[];
  detect: (content: string) => boolean;
  parse: (content: string) => ParseResult;
}

const parsers: Parser[] = [];

export function registerParser(parser: Parser) {
  parsers.push(parser);
}

export function detectFormat(filename: string, content: string): SupportedFormat {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  
  for (const parser of parsers) {
    if (parser.extensions.includes(ext) && parser.detect(content)) {
      return parser.format;
    }
  }
  
  if (ext === 'csv' || ext === 'txt') {
    return 'csv';
  }
  
  return 'unknown';
}

export function getParser(format: SupportedFormat): Parser | undefined {
  return parsers.find((p) => p.format === format);
}

export function getAllParsers(): Parser[] {
  return [...parsers];
}
