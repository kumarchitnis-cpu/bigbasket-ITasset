import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDocumentText, parseInvoiceText } from './parser.js';

test('parses invoice fields from a local OCR result and normalizes dates', () => {
  const extraction = parseInvoiceText([
    'INVOICE NUMBER: BB-2026-112',
    'SUPPLIER: Big Basket Supplier Pvt Ltd',
    'PO NO: PO-7788',
    'INVOICE DATE: 11/10/2026',
    'TOTAL AMOUNT: INR 12,450.50',
  ].join('\n'));

  assert.equal(extraction.invoice_number, 'BB-2026-112');
  assert.equal(extraction.vendor, 'Big Basket Supplier Pvt Ltd');
  assert.equal(extraction.purchase_order, 'PO-7788');
  assert.equal(extraction.invoice_date, '2026-10-11');
  assert.equal(extraction.currency, 'INR');
  assert.equal(extraction.total, 12450.5);
  assert.ok(extraction.confidence > 0);
  assert.ok(extraction.review_reason);
});

test('parses ISO and named-month invoice dates', () => {
  const iso = parseInvoiceText('Invoice Date: 2026-10-11');
  const named = parseInvoiceText('Dated: 11 Oct 2026');

  assert.equal(iso.invoice_date, '2026-10-11');
  assert.equal(named.invoice_date, '2026-10-11');
});

test('does not return invalid invoice dates', () => {
  const extraction = parseInvoiceText('Invoice Date: 31/02/2026');

  assert.equal(extraction.invoice_date, null);
  assert.equal(extraction.confidence, 0);
});

test('extracts purchase-order reference, supplier, dates, and total locally', () => {
  const extraction = parseDocumentText([
    'PURCHASE ORDER NO: PO-2048',
    'Supplier: Contoso Devices Ltd',
    'Order Date: 2026-10-10',
    'Expected Delivery: 2026-10-24',
    'Order Total: INR 45,200.00',
  ].join('\n'), 'PURCHASE_ORDER');

  assert.equal(extraction.document_type, 'PURCHASE_ORDER');
  assert.equal(extraction.purchase_order_number, 'PO-2048');
  assert.equal(extraction.vendor, 'Contoso Devices Ltd');
  assert.equal(extraction.order_date, '2026-10-10');
  assert.equal(extraction.delivery_date, '2026-10-24');
  assert.equal(extraction.total, 45200);
  assert.match(extraction.raw_text, /Contoso Devices/);
});

test('extracts asset model, serial number, tag, and assigned employee', () => {
  const extraction = parseDocumentText([
    'Manufacturer: Dell',
    'Model: Latitude 5440',
    'Service Tag: G6TB434',
    'Asset Tag: FA/464000',
    'Assigned To: Kumar Chitnis',
  ].join('\n'), 'WARRANTY');

  assert.equal(extraction.document_type, 'WARRANTY');
  assert.equal(extraction.assets[0].manufacturer, 'Dell');
  assert.equal(extraction.assets[0].model, 'Latitude 5440');
  assert.equal(extraction.assets[0].serial_number, 'G6TB434');
  assert.equal(extraction.assets[0].asset_tag, 'FA/464000');
  assert.equal(extraction.assets[0].assigned_to, 'Kumar Chitnis');
  assert.ok(extraction.confidence > 0);
});
