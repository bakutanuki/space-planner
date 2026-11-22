import type { ItemType } from './types';

export interface CatalogPiece { type: ItemType; name: string; w: number; d: number; h: number; color: string | null; note: string }

// Rafa's own furniture with maker sizes (cm): width left–right as it faces you, depth front–back, height
export const MY_FURNITURE: CatalogPiece[] = [
  { type: 'bed', name: 'SLATTUM bed (Full)', w: 139, d: 196, h: 40, color: '#4a4d52', note: 'IKEA SLATTUM Full/matrimonial, Vissle grey. Headboard 85 cm tall.' },
  { type: 'box', name: 'BILLY bookcase', w: 80, d: 28, h: 106, color: '#2e2a26', note: 'IKEA BILLY, black oak effect.' },
  { type: 'nightstand', name: 'MALM 4 drawers', w: 80, d: 48, h: 100, color: '#2b2420', note: 'IKEA MALM chest of 4 drawers, black-brown.' },
  { type: 'box', name: 'Laundry hamper', w: 76, d: 33, h: 81, color: '#232323', note: 'PICOOL FABATO 110 L, black, on wheels.' },
  { type: 'box', name: 'Bookshelf', w: 60, d: 30, h: 194, color: null, note: '60 wide × 30 deep × 194 tall.' },
];
