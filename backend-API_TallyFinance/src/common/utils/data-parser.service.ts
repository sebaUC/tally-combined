import { Injectable } from '@nestjs/common';

@Injectable()
export class DataParserService {
  sanitizeMaskedDigits(raw?: string | null) {
    if (!raw) return null;
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 4) {
      return null;
    }
    return digits.slice(-4);
  }

  parseAmount(raw?: string | null): number | null {
    if (raw === undefined || raw === null) {
      return null;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      return null;
    }

    let cleaned = trimmed.replace(/[^\d,.-]/g, '');
    if (!cleaned) {
      return null;
    }

    const hasComma = cleaned.includes(',');
    const hasDot = cleaned.includes('.');

    if (hasComma && hasDot) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else if (hasComma && !hasDot) {
      cleaned = cleaned.replace(',', '.');
    }

    const value = Number(cleaned);
    if (!Number.isFinite(value)) {
      return null;
    }
    return value;
  }
}
