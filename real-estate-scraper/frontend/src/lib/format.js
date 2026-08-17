/** Formátování čísel pro české UI. Sdílí karty, detail i sidebar. */

export function formatCzk(value) {
  if (value == null) return '—';
  return `${Math.round(Number(value)).toLocaleString('cs-CZ')} Kč`;
}

/** "2,7 mil. Kč" — kompaktní zápis do sliderů a hlaviček. */
export function formatMillions(value) {
  if (value == null) return '—';
  const millions = Number(value) / 1_000_000;
  if (millions < 1) return `${Math.round(Number(value) / 1000)} tis. Kč`;
  return `${millions.toFixed(1).replace('.', ',')} mil. Kč`;
}

export function formatPerM2(value) {
  if (value == null) return '—';
  return `${Math.round(Number(value)).toLocaleString('cs-CZ')} Kč/m²`;
}

export function formatArea(value) {
  if (value == null) return '—';
  return `${Math.round(Number(value))} m²`;
}

export function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('cs-CZ');
}

/** Popisky filtrů — hodnoty z DB jsou bez diakritiky kvůli enum. */
export const LABELS = {
  buildingType: { cihlova: 'Cihlová', panelova: 'Panelová', smisena: 'Smíšená' },
  condition: { dobry: 'Dobrý', k_rekonstrukci: 'K rekonstrukci', novostavba: 'Novostavba' },
  amenity: {
    balkon: 'Balkón',
    terasa: 'Terasa',
    lodzie: 'Lodžie',
    sklep: 'Sklep',
    vytah: 'Výtah',
    garaz: 'Garáž',
    parkovani: 'Parkování'
  }
};
