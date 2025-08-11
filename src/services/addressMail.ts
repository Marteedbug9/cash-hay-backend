export async function sendLetter(args: {
  to: {
    address_line1: string; address_line2?: string; city: string;
    department?: string; postal_code?: string; country: string;
  };
  code: string;
  user: { id: string; email?: string };
}): Promise<{ pdfUrl: string; providerId: string }> {
  // TODO: génère un PDF + envoi via prestataire (Lob/ClickSend/Imprimeur local)
  return { pdfUrl: 'https://example.com/letter.pdf', providerId: 'LOCAL-PRINT-1' };
}
