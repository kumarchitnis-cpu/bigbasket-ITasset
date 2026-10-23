import { useMemo, useState } from 'react';
import { Printer, QrCode, X } from 'lucide-react';
import { ApiError, api, type AppUser } from '@/lib/api';
import type { Asset, InventoryReceipt } from '@/lib/types';
import { downloadCsv, formatDate, groupCount, uniqueSorted } from '@/lib/format';
import { Banner, EmptyState, FilterSelect, MiniStat, PageTitle, PanelHeader, StatStrip, StatusBadge } from '@/components/ui';
import { HorizontalBars } from '@/components/charts';

function qrCodeMatrix(value: string): boolean[][] | null {
  const bytes = Array.from(new TextEncoder().encode(value));
  const versions = [
    { size: 21, data: 19, ecc: 7, blocks: 1, alignment: [] as number[] },
    { size: 25, data: 34, ecc: 10, blocks: 1, alignment: [6, 18] },
    { size: 29, data: 55, ecc: 15, blocks: 1, alignment: [6, 22] },
    { size: 33, data: 80, ecc: 20, blocks: 1, alignment: [6, 26] },
    { size: 37, data: 108, ecc: 26, blocks: 1, alignment: [6, 30] },
    { size: 41, data: 136, ecc: 18, blocks: 2, alignment: [6, 34] },
  ];
  const version = versions.find(({ data }) => bytes.length <= data - 2);
  if (!version) return null;

  const bits: number[] = [];
  const appendBits = (number: number, count: number) => {
    for (let bit = count - 1; bit >= 0; bit -= 1) bits.push((number >>> bit) & 1);
  };
  appendBits(0b0100, 4);
  appendBits(bytes.length, 8);
  bytes.forEach((byte) => appendBits(byte, 8));
  const capacity = version.data * 8;
  appendBits(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8) bits.push(0);
  const dataWords: number[] = [];
  for (let index = 0; index < bits.length; index += 8) dataWords.push(bits.slice(index, index + 8).reduce((word, bit) => (word << 1) | bit, 0));
  for (let pad = 0; dataWords.length < version.data; pad += 1) dataWords.push(pad % 2 ? 0x11 : 0xec);

  const multiply = (left: number, right: number) => {
    let result = 0;
    for (let bit = 7; bit >= 0; bit -= 1) {
      result = (result << 1) ^ ((result >>> 7) * 0x11d);
      if ((right >>> bit) & 1) result ^= left;
    }
    return result;
  };
  const dataPerBlock = version.data / version.blocks;
  const dataBlocks = Array.from({ length: version.blocks }, (_, block) => dataWords.slice(block * dataPerBlock, (block + 1) * dataPerBlock));
  const eccBlocks = dataBlocks.map((block) => {
    let generator = [1];
    let root = 1;
    for (let index = 0; index < version.ecc; index += 1) {
      const next = Array(generator.length + 1).fill(0) as number[];
      generator.forEach((coefficient, position) => {
        next[position] ^= coefficient;
        next[position + 1] ^= multiply(coefficient, root);
      });
      generator = next;
      root = multiply(root, 2);
    }
    const remainder = Array(version.ecc).fill(0) as number[];
    for (const word of block) {
      const factor = word ^ remainder[0];
      remainder.shift();
      remainder.push(0);
      for (let index = 0; index < remainder.length; index += 1) remainder[index] ^= multiply(generator[index + 1], factor);
    }
    return remainder;
  });
  const codewords: number[] = [];
  for (let index = 0; index < dataPerBlock; index += 1) dataBlocks.forEach((block) => codewords.push(block[index]));
  for (let index = 0; index < version.ecc; index += 1) eccBlocks.forEach((block) => codewords.push(block[index]));

  const matrix = Array.from({ length: version.size }, () => Array(version.size).fill(false) as boolean[]);
  const reserved = Array.from({ length: version.size }, () => Array(version.size).fill(false) as boolean[]);
  const setFunction = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= version.size || y >= version.size) return;
    matrix[y][x] = dark;
    reserved[y][x] = true;
  };
  const drawFinder = (left: number, top: number) => {
    for (let dy = -1; dy <= 7; dy += 1) for (let dx = -1; dx <= 7; dx += 1) {
      const distance = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      setFunction(left + dx, top + dy, distance !== 2 && distance !== 4);
    }
  };
  drawFinder(0, 0);
  drawFinder(version.size - 7, 0);
  drawFinder(0, version.size - 7);
  for (let index = 8; index < version.size - 8; index += 1) {
    setFunction(6, index, index % 2 === 0);
    setFunction(index, 6, index % 2 === 0);
  }
  for (const centerY of version.alignment) for (const centerX of version.alignment) {
    if (reserved[centerY][centerX]) continue;
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
      setFunction(centerX + dx, centerY + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  const formatData = 0b01000; // Error correction level L, mask pattern 0.
  let formatRemainder = formatData << 10;
  for (let bit = 14; bit >= 10; bit -= 1) if ((formatRemainder >>> bit) & 1) formatRemainder ^= 0x537 << (bit - 10);
  const format = ((formatData << 10) | formatRemainder) ^ 0x5412;
  const formatBit = (index: number) => Boolean((format >>> index) & 1);
  for (let index = 0; index <= 5; index += 1) setFunction(8, index, formatBit(index));
  setFunction(8, 7, formatBit(6));
  setFunction(8, 8, formatBit(7));
  setFunction(7, 8, formatBit(8));
  for (let index = 9; index < 15; index += 1) setFunction(14 - index, 8, formatBit(index));
  for (let index = 0; index < 8; index += 1) setFunction(version.size - 1 - index, 8, formatBit(index));
  for (let index = 8; index < 15; index += 1) setFunction(8, version.size - 15 + index, formatBit(index));
  setFunction(8, version.size - 8, true);

  const dataBits = codewords.flatMap((word) => Array.from({ length: 8 }, (_, index) => (word >>> (7 - index)) & 1));
  let bitIndex = 0;
  let upward = true;
  for (let right = version.size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let offset = 0; offset < version.size; offset += 1) {
      const y = upward ? version.size - 1 - offset : offset;
      for (let column = 0; column < 2; column += 1) {
        const x = right - column;
        if (reserved[y][x]) continue;
        const dark = (dataBits[bitIndex] ?? 0) === 1;
        matrix[y][x] = (x + y) % 2 === 0 ? !dark : dark;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
  return matrix;
}

function QrCodeGraphic({ asset }: { asset: Asset }) {
  const value = `Make: ${asset.manufacturer}\nModel: ${asset.model}\nSerial No: ${asset.serial_number}\nAsset Tag: ${asset.asset_tag}\nLocation: ${asset.location}`;
  const matrix = useMemo(() => qrCodeMatrix(value), [value]);
  if (!matrix) return <span className="inventory-qr-overflow">Tag is too long for a QR code</span>;
  const size = matrix.length;
  const path = matrix.flatMap((row, y) => row.flatMap((dark, x) => dark ? [`M${x},${y}h1v1h-1z`] : [])).join('');
  return <svg className="inventory-qr" viewBox={`-4 -4 ${size + 8} ${size + 8}`} role="img" aria-label={`QR code for asset tag ${value}`}><rect x={-4} y={-4} width={size + 8} height={size + 8} fill="#fff" /><path d={path} fill="#142b43" /></svg>;
}

function AssetLabel({ asset }: { asset: Asset }) {
  return (
    <article className="inventory-asset-label">
      <strong>{asset.manufacturer} {asset.model}</strong>
      <span>{asset.category} · {asset.serial_number}</span>
      <QrCodeGraphic asset={asset} />
      <b>Asset Tag: {asset.asset_tag}</b>
      <small>{asset.location}</small>
    </article>
  );
}

function CreatedBarcodeModal({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-card inventory-barcode-modal">
        <div className="modal-header"><div><p className="eyebrow">Inventory / Barcode</p><h2>{asset.asset_tag}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="barcode-print-sheet inventory-single-print"><AssetLabel asset={asset} /></div>
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Close</button><button type="button" className="button button-primary" onClick={() => window.print()}><Printer size={15} /> Print</button></div>
      </div>
    </div>
  );
}

function BarcodeModal({ assets, initialAssetId, onClose, onCreated }: { assets: Asset[]; initialAssetId?: string; onClose: () => void; onCreated: (asset: Asset) => void }) {
  const [assetId, setAssetId] = useState(initialAssetId && assets.some((asset) => asset.id === initialAssetId) ? initialAssetId : assets[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selected = assets.find((asset) => asset.id === assetId);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.post<{ assets: Asset[]; skipped: number }>('/api/assets/barcodes/bulk', { asset_ids: [selected.id] });
      if (result.assets[0]) onCreated(result.assets[0]);
      else setError('This asset already has a barcode or is no longer available.');
    } catch (err) {
      setError(err instanceof ApiError
        ? err.status === 404 ? 'The barcode API is not available yet. Restart the ITAM API server or deploy the updated server, then retry.' : err.message
        : 'Could not create the barcode.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="modal-card inventory-barcode-modal" onSubmit={submit}>
        <div className="modal-header"><div><p className="eyebrow">Inventory / Available stock</p><h2>Create barcode</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <label className="inventory-asset-select">Available stock asset<select required value={assetId} onChange={(event) => setAssetId(event.target.value)}>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.asset_tag || 'Asset tag needed'} · {asset.manufacturer} {asset.model} · {asset.serial_number}</option>)}</select></label>
        {selected && <div className="inventory-barcode-preview"><AssetLabel asset={selected} /></div>}
        {error && <div className="auth-message" role="alert">{error}</div>}
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy || !selected}>{busy ? 'Creating…' : 'Create barcode'}</button></div>
      </form>
    </div>
  );
}

export function InventoryView(props: { assets: Asset[]; receipts: InventoryReceipt[]; user: AppUser; onSaved: () => void }): JSX.Element {
  const { assets, receipts, user, onSaved } = props;
  const [barcodeModalOpen, setBarcodeModalOpen] = useState(false);
  const [barcodeAssetId, setBarcodeAssetId] = useState<string | undefined>();
  const [viewBarcodeAsset, setViewBarcodeAsset] = useState<Asset | null>(null);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [createdLabels, setCreatedLabels] = useState<Asset[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const stock = assets.filter((asset) => asset.status === 'AVAILABLE');
  const filteredStock = stock.filter((asset) => (!categoryFilter || asset.category === categoryFilter) && (!locationFilter || asset.location === locationFilter));
  const eligibleStock = stock.filter((asset) => !asset.barcode_created_at || !asset.barcode_value || !asset.asset_tag?.trim());
  const categories = uniqueSorted(stock.map((asset) => asset.category));
  const locations = uniqueSorted(stock.map((asset) => asset.location));
  const canCreate = ['admin', 'it_asset_manager'].includes(user.role);
  const discrepancyCount = receipts.filter((receipt) => receipt.status === 'DISCREPANCY').length;
  const categoryBars = groupCount(stock, (asset) => asset.category).map((group) => ({ label: group.name, value: group.value }));
  const locationBars = groupCount(stock, (asset) => asset.location).map((group) => ({ label: group.name, value: group.value }));
  const downloadStock = () => {
    const rows: (string | number)[][] = [['Asset Tag', 'Category', 'Manufacturer', 'Model', 'Serial', 'Location', 'Barcode']];
    for (const asset of filteredStock) rows.push([asset.asset_tag, asset.category, asset.manufacturer, asset.model, asset.serial_number, asset.location, asset.barcode_value || 'Not created']);
    downloadCsv('inventory-stock.csv', rows);
  };
  const createBulk = async () => {
    setBulkBusy(true);
    setBulkError('');
    try {
      const result = await api.post<{ assets: Asset[]; skipped: number }>('/api/assets/barcodes/bulk', { asset_ids: eligibleStock.map((asset) => asset.id) });
      setCreatedLabels(result.assets);
      onSaved();
      if (!result.assets.length) setBulkError('There are no eligible available assets to barcode.');
    } catch (err) {
      setBulkError(err instanceof ApiError
        ? err.status === 404 ? 'The barcode API is not available yet. Restart the ITAM API server or deploy the updated server, then retry.' : err.message
        : 'Could not create bulk barcodes.');
    } finally {
      setBulkBusy(false);
    }
  };
  const createdCount = useMemo(() => stock.filter((asset) => Boolean(asset.barcode_created_at && asset.barcode_value)).length, [stock]);

  return (
    <div className="fade-in">
      <PageTitle eyebrow="Inventory / Stock operations" title="Inventory" copy="Manage available stock and create QR labels for assets." action={canCreate ? 'Create Barcode' : undefined} icon={QrCode} onAction={canCreate && eligibleStock.length ? () => { setBarcodeAssetId(undefined); setBarcodeModalOpen(true); } : undefined} />
      <StatStrip>
        <MiniStat label="Available assets" value={stock.length.toString()} tone="teal" />
        <MiniStat label="Categories in stock" value={categories.length.toString()} tone="blue" />
        <MiniStat label="Barcodes created" value={createdCount.toString()} tone="teal" />
        <MiniStat label="Missing barcodes" value={eligibleStock.length.toString()} tone="amber" />
      </StatStrip>
      {discrepancyCount > 0 && <Banner tone="amber" title={`${discrepancyCount} receipt(s) need supplier follow-up`} />}
      <div className="filter-note">
        <FilterSelect label="Category" value={categoryFilter} onChange={setCategoryFilter}><option value="">All categories</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</FilterSelect>
        <FilterSelect label="Location" value={locationFilter} onChange={setLocationFilter}><option value="">All locations</option>{locations.map((location) => <option key={location} value={location}>{location}</option>)}</FilterSelect>
        <button className="button button-secondary" onClick={downloadStock}>Download CSV</button>
        {canCreate && <button className="button button-secondary" disabled={!eligibleStock.length || bulkBusy} onClick={() => void createBulk()}>{bulkBusy ? 'Creating labels…' : `Bulk create missing (${eligibleStock.length})`}</button>}
      </div>
      {bulkError && <Banner tone="info" title={bulkError} />}
      {createdLabels.length > 0 && <section className="panel inventory-created-panel"><PanelHeader title={`${createdLabels.length} barcode label(s) created`} subtitle="Asset details and asset tags are ready to print" /><div className="inventory-label-actions"><button className="button button-primary" onClick={() => window.print()}><Printer size={15} /> Print labels</button><button className="button button-secondary" onClick={() => setCreatedLabels([])}>Dismiss</button></div><div className="barcode-print-sheet">{createdLabels.map((asset) => <AssetLabel key={asset.id} asset={asset} />)}</div></section>}
      <section className="panel table-panel full-panel">
        <PanelHeader title="Available stock" subtitle="Select from available stock to create its barcode" />
        <div className="data-table-wrap"><table className="data-table">
          <thead><tr><th>Asset Tag</th><th>Category</th><th>Manufacturer</th><th>Model</th><th>Serial</th><th>Location</th><th>BARCODE</th></tr></thead>
          <tbody>{filteredStock.map((asset) => {
            const created = Boolean(asset.barcode_created_at && asset.barcode_value);
            return <tr key={asset.id}><td>{asset.asset_tag || <span className="muted-cell">Missing</span>}</td><td>{asset.category}</td><td>{asset.manufacturer}</td><td>{asset.model}</td><td>{asset.serial_number}</td><td>{asset.location}</td><td>{created || canCreate ? <button type="button" className={`inventory-barcode-status ${created ? 'created' : 'missing'}`} onClick={() => { if (created) { setCreatedLabels([]); setViewBarcodeAsset(asset); } else { setBarcodeAssetId(asset.id); setBarcodeModalOpen(true); } }}>{created ? 'Created' : 'Not Created'}</button> : <span className="muted-cell">Not Created</span>}</td></tr>;
          })}</tbody>
        </table>{filteredStock.length === 0 && <EmptyState text="No stock matches the filters." />}</div>
      </section>
      <section className="panel table-panel full-panel module-panel-gap"><PanelHeader title="Stock by category" subtitle="Count per category" /><HorizontalBars data={categoryBars} /></section>
      <section className="panel table-panel full-panel module-panel-gap"><PanelHeader title="Stock by location" subtitle="Count per location" /><HorizontalBars data={locationBars} /></section>
      <section className="panel table-panel full-panel module-panel-gap">
        <PanelHeader title="Recent goods receipts" subtitle="Received and accepted quantities recorded against purchase orders" />
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Receipt</th><th>Purchase order</th><th>Supplier</th><th>Received</th><th>Accepted / ordered</th><th>Status</th></tr></thead><tbody>{receipts.map((receipt) => <tr key={receipt.id}><td><strong>{receipt.receipt_number}</strong></td><td>{receipt.purchase_order}</td><td>{receipt.vendor}</td><td>{formatDate(receipt.received_date)}</td><td>{receipt.accepted_quantity} / {receipt.ordered_quantity}</td><td><StatusBadge status={receipt.status} /></td></tr>)}</tbody></table>{receipts.length === 0 && <EmptyState text="No goods receipts recorded yet." />}</div>
      </section>
      {barcodeModalOpen && <BarcodeModal assets={eligibleStock} initialAssetId={barcodeAssetId} onClose={() => setBarcodeModalOpen(false)} onCreated={(asset) => { setBarcodeModalOpen(false); setCreatedLabels([asset]); onSaved(); }} />}
      {viewBarcodeAsset && <CreatedBarcodeModal asset={viewBarcodeAsset} onClose={() => setViewBarcodeAsset(null)} />}
    </div>
  );
}
