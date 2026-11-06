/** Accepts canonical or standard punctuated numeric and alphanumeric CNPJ. */
export function normalizeTrialCnpj(value: string): string | null {
  const input = value.trim().toUpperCase();
  if (!/^(?:[A-Z0-9]{12}[0-9]{2}|[A-Z0-9]{2}\.[A-Z0-9]{3}\.[A-Z0-9]{3}\/[A-Z0-9]{4}-[0-9]{2})$/.test(input)) return null;
  const cnpj = input.replace(/[.\/-]/g, '');
  if (/^(\d)\1{13}$/.test(cnpj)) return null;

  const digit = (base: string): number => {
    let sum = 0;
    for (let index = base.length - 1, weight = 2; index >= 0; index--, weight = weight === 9 ? 2 : weight + 1) {
      sum += (base.charCodeAt(index) - 48) * weight;
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const base = cnpj.slice(0, 12);
  const first = digit(base);
  return cnpj === base + first + digit(base + first) ? cnpj : null;
}
