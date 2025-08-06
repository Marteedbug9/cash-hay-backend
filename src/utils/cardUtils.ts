// src/utils/cardUtils.ts

export const generateMockCardNumber = (): string => {
  // Format Visa test : commence par 42, 16 chiffres
  return '42' + Math.floor(100000000000000 + Math.random() * 900000000000000).toString();
};

export const generateExpiryDate = (): string => {
  const now = new Date();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const year = (now.getFullYear() + 4).toString().slice(-2); // Exemple : 29
  return `${month}/${year}`; // MM/YY
};

export const generateCVV = (): string => {
  return Math.floor(100 + Math.random() * 900).toString(); // 3 chiffres aléatoires
};

export const buildMarqetaCardRequest = ({
  userToken,
  cardProductToken,
}: {
  userToken: string;
  cardProductToken: string;
}) => {
  return {
    card_product_token: cardProductToken,
    user_token: userToken,
    token: `card_${userToken}_${Date.now()}`,
    exp_date: generateExpiryDate(), // utile si fourni manuellement
    show_cvv_number: true,
    show_pan: true,
    show_expiration: true,
  };
};
