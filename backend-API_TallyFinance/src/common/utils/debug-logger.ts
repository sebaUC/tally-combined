/**
 * Unified Debug Logger for TallyFinance Backend
 *
 * Provides clean, visual, flow-focused logging with:
 * - Color-coded output for different phases
 * - Emoji indicators for quick scanning
 * - Correlation ID tracking across requests
 * - Timing information for performance monitoring
 *
 * Visual Language:
 *   📥 RECV     - Incoming message/request
 *   📤 SEND     - Outgoing response
 *   🔄 PHASE    - Processing phase (A, B)
 *   🔧 TOOL     - Tool execution
 *   💾 STATE    - State changes (Redis, DB)
 *   ⚡ PERF     - Performance timing
 *   ✅ OK       - Success
 *   ❌ ERR      - Error
 *   ⚠️  WARN     - Warning
 *   🔗 LINK     - External service call
 *   🎯 MATCH    - Pattern/category matching
 */

// ANSI color codes for terminal
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // Background colors
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
};

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface DebugConfig {
  enabled: boolean;
  minLevel: LogLevel;
  showTimestamp: boolean;
  showCorrelationId: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Configuration from environment
const config: DebugConfig = {
  enabled: process.env.DEBUG_LOGS !== '0',
  minLevel: (process.env.DEBUG_LEVEL as LogLevel) || 'debug',
  showTimestamp: process.env.DEBUG_TIMESTAMP !== '0',
  showCorrelationId: true,
};

/**
 * Format a value for display (truncate if too long)
 */
function formatValue(value: unknown, maxLen = 80): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') {
    const clean = value.replace(/\n/g, '↵').trim();
    return clean.length > maxLen ? clean.substring(0, maxLen) + '…' : clean;
  }
  if (typeof value === 'object') {
    const str = JSON.stringify(value);
    return str.length > maxLen ? str.substring(0, maxLen) + '…' : str;
  }
  return String(value);
}

/**
 * Format milliseconds duration
 */
function formatMs(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Get timestamp string
 */
function timestamp(): string {
  if (!config.showTimestamp) return '';
  const now = new Date();
  const time = now.toTimeString().split(' ')[0];
  const ms = now.getMilliseconds().toString().padStart(3, '0');
  return `${colors.dim}${time}.${ms}${colors.reset} `;
}

/**
 * Format correlation ID
 */
function formatCid(cid?: string): string {
  if (!config.showCorrelationId || !cid) return '';
  return `${colors.dim}[${cid}]${colors.reset} `;
}

/**
 * Main debug logger class
 */
class DebugLogger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  private shouldLog(level: LogLevel): boolean {
    if (!config.enabled) return false;
    return LOG_LEVELS[level] >= LOG_LEVELS[config.minLevel];
  }

  private log(
    level: LogLevel,
    emoji: string,
    tag: string,
    message: string,
    data?: Record<string, unknown>,
    cid?: string,
  ) {
    if (!this.shouldLog(level)) return;

    const tagColors: Record<string, string> = {
      RECV: colors.cyan,
      SEND: colors.green,
      'PHASE-A': colors.magenta,
      'PHASE-B': colors.blue,
      TOOL: colors.yellow,
      STATE: colors.dim,
      PERF: colors.bright,
      OK: colors.green,
      ERR: colors.red,
      WARN: colors.yellow,
      LINK: colors.cyan,
      MATCH: colors.green,
      PENDING: colors.yellow,
      SLOT: colors.magenta,
    };

    const tagColor = tagColors[tag] || colors.white;
    const paddedTag = tag.padEnd(7);

    let line = `${timestamp()}${formatCid(cid)}${emoji} ${tagColor}${paddedTag}${colors.reset} ${colors.dim}${this.context}${colors.reset} ${message}`;

    if (data && Object.keys(data).length > 0) {
      const dataStr = Object.entries(data)
        .map(([k, v]) => `${colors.dim}${k}=${colors.reset}${formatValue(v)}`)
        .join(' ');
      line += ` ${dataStr}`;
    }

    console.log(line);
  }

  // =========== Flow Events ===========

  /** Incoming message received */
  recv(message: string, data?: Record<string, unknown>, cid?: string) {
    this.log('info', '📥', 'RECV', message, data, cid);
  }

  /** Outgoing response sent */
  send(message: string, data?: Record<string, unknown>, cid?: string) {
    this.log('info', '📤', 'SEND', message, data, cid);
  }

  /** Phase A started/completed */
  phaseA(message: string, data?: Record<string, unknown>, cid?: string) {
    this.log('info', '🔄', 'PHASE-A', message, data, cid);
  }

  /** Phase B started/completed */
  phaseB(message: string, data?: Record<string, unknown>, cid?: string) {
    this.log('info', '🔄', 'PHASE-B', message, data, cid);
  }

  /** Tool execution */
  tool(message: string, data?: Record<string, unknown>, cid?: string) {
    this.log('info', '🔧', 'TOOL', message, data, cid);
  }

  /** State change (Redis, DB) */
  state(message: string, data?: Record<string, unknown>, cid?: string) {
    this.log('debug', '💾', 'STATE', message, data, cid);
  }

  /** Performance timing */
  perf(message: string, ms: number, cid?: string) {
    const formatted = formatMs(ms);
    const color = ms < 100 ? colors.green : ms < 500 ? colors.yellow : colors.red;
    this.log('info', '⚡', 'PERF', message, { time: `${color}${formatted}${colors.reset}` }, cid);
  }

  /** Success */
  ok(message: string, data?: Record<string, unknown>, cid?: string) {
    this.log('info', '✅', 'OK', message, data, cid);
  }

  /** Error */
  err(message: string, data?: Record<string, unknown>, cid?: string) {
    this.log('error', '❌', 'ERR', message, data, cid);
  }

  /** Warning */
  warn(message: string, data?: Record<string, unknown>, cid?: string) {
    this.log('warn', '⚠️ ', 'WARN', message, data, cid);
  }

  /** External service call */
  link(message: string, data?: Record<string, unknown>, cid?: string) {
    this.log('info', '🔗', 'LINK', message, data, cid);
  }

  /** Pattern/category matching */
  match(message: string, data?: Record<string, unknown>, cid?: string) {
    this.log('debug', '🎯', 'MATCH', message, data, cid);
  }

  /** Pending slot-fill state */
  pending(message: string, data?: Record<string, unknown>, cid?: string) {
    this.log('info', '⏳', 'PENDING', message, data, cid);
  }

  /** Slot-filling event */
  slot(message: string, data?: Record<string, unknown>, cid?: string) {
    this.log('info', '🧩', 'SLOT', message, data, cid);
  }

  // =========== Utility Methods ===========

  /** Create a child logger with a sub-context */
  child(subContext: string): DebugLogger {
    return new DebugLogger(`${this.context}:${subContext}`);
  }

  /** Log a separator line for visual grouping */
  separator(cid?: string) {
    if (!this.shouldLog('debug')) return;
    console.log(
      `${timestamp()}${formatCid(cid)}${colors.dim}${'─'.repeat(60)}${colors.reset}`,
    );
  }

  /** Start a timer and return a function to log the elapsed time */
  timer(label: string, cid?: string): () => void {
    const start = Date.now();
    return () => {
      this.perf(label, Date.now() - start, cid);
    };
  }
}

/**
 * Create a debug logger for a specific context
 */
export function createDebugLogger(context: string): DebugLogger {
  return new DebugLogger(context);
}

/**
 * Singleton loggers for common contexts
 */
export const debugLog = {
  bot: createDebugLogger('bot'),
  orchestrator: createDebugLogger('orchestrator'),
  redis: createDebugLogger('redis'),
  tools: createDebugLogger('tools'),
  auth: createDebugLogger('auth'),
};

export { DebugLogger };
