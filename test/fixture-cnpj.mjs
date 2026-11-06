// Synthetic CNPJ for isolated CI only. Never send these values to public services.
export function fixtureCnpj(random = Math.random) {
  const root = String(10000000 + Math.floor(random() * 90000000));
  let value = root + '0001';
  for (const weights of [[5,4,3,2,9,8,7,6,5,4,3,2], [6,5,4,3,2,9,8,7,6,5,4,3,2]]) {
    const remainder = weights.reduce((sum, weight, index) => sum + Number(value[index]) * weight, 0) % 11;
    value += remainder < 2 ? 0 : 11 - remainder;
  }
  return value;
}
