import { Injectable } from '@nestjs/common';

/**
 * User writing style detected from message text.
 */
export interface UserStyle {
  usesLucas: boolean;
  usesChilenismos: boolean;
  emojiLevel: 'none' | 'light' | 'moderate';
  isFormal: boolean;
}

/**
 * Style detector service.
 *
 * Uses regex patterns to detect user writing style from message text.
 * Passed to AI-Service in RuntimeContext for style mirroring.
 */
@Injectable()
export class StyleDetectorService {
  /**
   * Detects user writing style from message text.
   */
  detect(text: string): UserStyle {
    return {
      usesLucas: this.detectUsesLucas(text),
      usesChilenismos: this.detectChilenismos(text),
      emojiLevel: this.detectEmojiLevel(text),
      isFormal: this.detectFormal(text),
    };
  }

  private detectUsesLucas(text: string): boolean {
    return /lucas?|luca\b/i.test(text);
  }

  private detectChilenismos(text: string): boolean {
    return /cachai|wena|po\b|bacán|fome|pega|polola?|al tiro|altiro/i.test(
      text,
    );
  }

  private detectEmojiLevel(text: string): 'none' | 'light' | 'moderate' {
    const emojiCount = this.countEmojis(text);
    if (emojiCount > 2) return 'moderate';
    if (emojiCount > 0) return 'light';
    return 'none';
  }

  private detectFormal(text: string): boolean {
    return /usted|podría|estimado|favor|disculpe|le agradezco/i.test(text);
  }

  private countEmojis(text: string): number {
    // Match common emoji ranges
    const emojiRegex =
      /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]/gu;
    const matches = text.match(emojiRegex);
    return matches ? matches.length : 0;
  }
}
