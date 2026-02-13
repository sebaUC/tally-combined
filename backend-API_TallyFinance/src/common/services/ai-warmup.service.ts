import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Service to handle AI Service warm-up and cold-start detection.
 *
 * Render free tier instances sleep after ~15 minutes of inactivity.
 * Cold starts take 30-50 seconds. This service helps manage that.
 */
@Injectable()
export class AiWarmupService {
  private readonly logger = new Logger(AiWarmupService.name);
  private readonly aiServiceUrl: string;

  // Track warm-up state
  private isWarming = false;
  private lastSuccessfulPing: number = 0;
  private readonly warmThresholdMs = 14 * 60 * 1000; // 14 minutes (before Render sleeps)

  constructor(private readonly config: ConfigService) {
    this.aiServiceUrl =
      this.config.get<string>('AI_SERVICE_URL') || 'http://localhost:8000';
  }

  /**
   * Check if AI service is likely cold (sleeping).
   */
  isLikelyCold(): boolean {
    const timeSinceLastPing = Date.now() - this.lastSuccessfulPing;
    return timeSinceLastPing > this.warmThresholdMs;
  }

  /**
   * Check if we're currently in a warming state.
   */
  isCurrentlyWarming(): boolean {
    return this.isWarming;
  }

  /**
   * Mark that we're starting a warm-up process.
   */
  startWarming(): void {
    this.isWarming = true;
    this.logger.log('😴 AI Service warming up started...');
  }

  /**
   * Mark that warm-up is complete.
   */
  finishWarming(): void {
    this.isWarming = false;
    this.lastSuccessfulPing = Date.now();
    this.logger.log('✅ AI Service is now warm');
  }

  /**
   * Fire-and-forget ping to wake up AI service.
   * Used on login/signup to preemptively wake the service.
   */
  async pingAsync(): Promise<void> {
    // Don't ping if already warming or recently pinged
    if (this.isWarming) {
      this.logger.debug('Already warming, skipping ping');
      return;
    }

    if (!this.isLikelyCold()) {
      this.logger.debug('AI service likely warm, skipping ping');
      return;
    }

    this.startWarming();

    // Fire and forget - don't await
    this.doPing().catch((err) => {
      this.logger.warn(`Async ping failed: ${err.message}`);
    });
  }

  /**
   * Synchronous ping with timeout - used to check if service is ready.
   */
  async ping(timeoutMs: number = 5000): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(`${this.aiServiceUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        this.lastSuccessfulPing = Date.now();
        this.isWarming = false;
        return true;
      }
      return false;
    } catch (err) {
      return false;
    }
  }

  /**
   * Internal ping implementation with longer timeout for wake-up.
   */
  private async doPing(): Promise<void> {
    const maxWaitMs = 60000; // Wait up to 60s for cold start
    const startTime = Date.now();

    this.logger.log(`😴 Pinging AI service to wake it up...`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), maxWaitMs);

      const response = await fetch(`${this.aiServiceUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const elapsed = Date.now() - startTime;

      if (response.ok) {
        this.lastSuccessfulPing = Date.now();
        this.isWarming = false;
        this.logger.log(`☀️ AI Service awake after ${elapsed}ms`);
      } else {
        this.logger.warn(`AI health check returned ${response.status}`);
        this.isWarming = false;
      }
    } catch (err) {
      const elapsed = Date.now() - startTime;
      this.logger.warn(`😴 AI ping failed after ${elapsed}ms: ${err.message}`);
      this.isWarming = false;
    }
  }

  /**
   * Get a friendly wake-up message for users.
   */
  getWakeUpMessage(): string {
    return '😴💤 Estoy despertando, dame un momento...';
  }

  /**
   * Get message to send when wake-up is taking too long.
   */
  getStillWakingMessage(): string {
    return '😪 Sigo despertando... intenta de nuevo en unos segundos.';
  }
}
