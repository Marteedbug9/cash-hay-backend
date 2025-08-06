// src/constants/card.ts

// Statuts possibles pour une carte
export const CardStatus = {
  ACTIVE: 'active',
  PENDING: 'pending',
  PENDING_CANCEL: 'pending_cancel',
  LOCKED: 'locked',
  INACTIVE: 'inactive',
  CANCELLED: 'cancelled',
};

// Types de carte
export const CardType = {
  VIRTUAL: 'virtual',
  PHYSICAL: 'physical',
};

// Catégorie visuelle/personnalisée
export const CardCategory = {
  CLASSIC: 'classic',
  METAL: 'metal',
  CUSTOM: 'custom',
};

// Autres constantes liées aux limites ou au pays
export const DEFAULT_SPENDING_LIMIT = 5000;
export const DEFAULT_CURRENCY = 'usd';
export const DEFAULT_COUNTRY = 'HT';
export const DEFAULT_POSTAL_CODE = '9999';
