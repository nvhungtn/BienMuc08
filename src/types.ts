export interface BookRecord {
  id?: string;
  isbn: string;
  title: string;
  subTitle: string;
  author: string;
  publisher: string;
  pubYear: string;
  pages: string;
  language: string;
  ddc: string;
  cutter: string;
  price: string;
  dimensions: string;
  summary: string;
  subjects: string[];
  barcode: string;
  quantity: string;
  rawMarc?: string;
  createdAt?: string;
  unsynced?: boolean;
}

export interface MarcField {
  tag: string;
  ind1: string;
  ind2: string;
  subfields: { [key: string]: string[] };
}
