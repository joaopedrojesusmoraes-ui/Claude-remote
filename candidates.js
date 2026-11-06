// Lista oficial de candidatos. Os IDs são usados no banco de dados — não reutilize nem troque.
export const KINGS = [
  { id: 1, name: 'André Santos' },
  { id: 2, name: 'Francisco Rodrigues' },
  { id: 3, name: 'Lorenzo Petito' },
  { id: 4, name: 'Tales Salies' },
  { id: 5, name: 'Enzo Souza' },
  { id: 6, name: 'Gabriel Ávila' },
  { id: 7, name: 'Gabriel Batista' },
  { id: 8, name: 'João Victor Coutinho' },
  { id: 9, name: 'Pedro Henrique Avila' },
  { id: 10, name: 'Theo Rangel' },
  { id: 11, name: 'Thiago Castro' },
];

export const QUEENS = [
  { id: 12, name: 'Isabella Minasi' },
  { id: 13, name: 'Manuella Freitas' },
  { id: 14, name: 'Moana Luiza Crespo' },
  { id: 15, name: 'Raquel Gallo' },
  { id: 16, name: 'Karol Proença' },
  { id: 17, name: 'Piettra Donati' },
];

export const isKing = (id) => KINGS.some((c) => c.id === id);
export const isQueen = (id) => QUEENS.some((c) => c.id === id);
