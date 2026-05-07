/** @brief billing/invoicing */
export interface InvoiceLine {
  sku: string;
  quantity: number;
  unitPrice: number;
}

/** @brief billing/invoicing */
export class Invoice {
  constructor(public readonly id: string, public readonly lines: InvoiceLine[]) {}

  total(): number {
    return this.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  }
}

export function emptyInvoice(id: string): Invoice {
  return new Invoice(id, []);
}
