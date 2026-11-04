import { BadRequestException } from '@nestjs/common';

export function normalizeCpf(value?: string | null): string | null {
  if (value == null || value.trim() === '') return null;
  if (!/^[0-9.\-\s]+$/.test(value)) throw new BadRequestException('CPF invalido');
  const cpf = value.replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) throw new BadRequestException('CPF invalido');
  for (const length of [9, 10]) {
    let sum = 0;
    for (let index = 0; index < length; index++) sum += Number(cpf[index]) * (length + 1 - index);
    const digit = (sum * 10 % 11) % 10;
    if (digit !== Number(cpf[length])) throw new BadRequestException('CPF invalido');
  }
  return cpf;
}
