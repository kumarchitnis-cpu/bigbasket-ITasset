export function warrantyPortal(manufacturer: string) {
  const make = manufacturer.trim().toLowerCase();
  if (make.includes('dell')) return { name: 'Dell', url: 'https://www.dell.com/support/contractservices/en-in' };
  if (make.includes('lenovo')) return { name: 'Lenovo', url: 'https://pcsupport.lenovo.com/in/en/warranty-lookup#/' };
  if (make === 'hp' || make.startsWith('hp ') || make.includes('hewlett')) return { name: 'HP', url: 'https://support.hp.com/in-en/check-warranty' };
  if (make.includes('apple')) return { name: 'Apple', url: 'https://checkcoverage.apple.com/?locale=en_IN' };
  return null;
}
