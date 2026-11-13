declare module 'xlsx-populate/browser/xlsx-populate.js' {
  type XlsxRange = {
    value(values: unknown[][]): XlsxRange;
    style(styles: { bold?: boolean; fill?: string; fontColor?: string }): XlsxRange;
  };

  type XlsxSheet = {
    name(value: string): XlsxSheet;
    range(address: string): XlsxRange;
    autoFilter(range: XlsxRange): XlsxSheet;
    freezePanes(row: number, column: number): XlsxSheet;
    column(column: string): { width(value: number): XlsxSheet };
  };

  type XlsxWorkbook = {
    sheet(index: number): XlsxSheet;
    addSheet(name: string): XlsxSheet;
    outputAsync(options: { type: 'blob' }): Promise<Blob>;
  };

  const XlsxPopulate: {
    fromBlankAsync(): Promise<XlsxWorkbook>;
  };

  export default XlsxPopulate;
}
