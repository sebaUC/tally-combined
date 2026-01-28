"""
Unified Debug Logger for TallyFinance AI Service

Provides clean, visual, flow-focused logging with:
- Color-coded output for different phases
- Emoji indicators for quick scanning
- Correlation ID tracking across requests
- Timing information for performance monitoring

Visual Language (same as NestJS backend):
  📥 RECV     - Incoming message/request
  📤 SEND     - Outgoing response
  🔄 PHASE    - Processing phase (A, B)
  🔧 TOOL     - Tool execution
  💾 STATE    - State changes
  ⚡ PERF     - Performance timing
  ✅ OK       - Success
  ❌ ERR      - Error
  ⚠️  WARN     - Warning
  🔗 LINK     - External service call (OpenAI)
  🎯 MATCH    - Pattern matching
  🧠 AI       - AI/LLM operations
"""

import os
import time
import json
from datetime import datetime
from typing import Any, Dict, Optional, Callable
from functools import wraps

# ANSI color codes
class Colors:
    RESET = '\033[0m'
    BRIGHT = '\033[1m'
    DIM = '\033[2m'

    # Foreground
    BLACK = '\033[30m'
    RED = '\033[31m'
    GREEN = '\033[32m'
    YELLOW = '\033[33m'
    BLUE = '\033[34m'
    MAGENTA = '\033[35m'
    CYAN = '\033[36m'
    WHITE = '\033[37m'

    # Background
    BG_BLACK = '\033[40m'
    BG_RED = '\033[41m'
    BG_GREEN = '\033[42m'
    BG_YELLOW = '\033[43m'
    BG_BLUE = '\033[44m'
    BG_MAGENTA = '\033[45m'
    BG_CYAN = '\033[46m'
    BG_WHITE = '\033[47m'


# Configuration from environment
class DebugConfig:
    enabled: bool = os.getenv('DEBUG_LOGS', '1') != '0'
    min_level: str = os.getenv('DEBUG_LEVEL', 'debug')
    show_timestamp: bool = os.getenv('DEBUG_TIMESTAMP', '1') != '0'
    show_correlation_id: bool = True


LOG_LEVELS = {
    'debug': 0,
    'info': 1,
    'warn': 2,
    'error': 3,
}

TAG_COLORS = {
    'RECV': Colors.CYAN,
    'SEND': Colors.GREEN,
    'PHASE-A': Colors.MAGENTA,
    'PHASE-B': Colors.BLUE,
    'TOOL': Colors.YELLOW,
    'STATE': Colors.DIM,
    'PERF': Colors.BRIGHT,
    'OK': Colors.GREEN,
    'ERR': Colors.RED,
    'WARN': Colors.YELLOW,
    'LINK': Colors.CYAN,
    'MATCH': Colors.GREEN,
    'AI': Colors.MAGENTA,
    'PROMPT': Colors.BLUE,
    'MOOD': Colors.YELLOW,
}


def format_value(value: Any, max_len: int = 80) -> str:
    """Format a value for display (truncate if too long)"""
    if value is None:
        return 'null'
    if isinstance(value, str):
        clean = value.replace('\n', '↵').strip()
        return clean[:max_len] + '…' if len(clean) > max_len else clean
    if isinstance(value, dict) or isinstance(value, list):
        s = json.dumps(value, ensure_ascii=False)
        return s[:max_len] + '…' if len(s) > max_len else s
    return str(value)


def format_ms(ms: float) -> str:
    """Format milliseconds duration"""
    if ms < 1:
        return '<1ms'
    if ms < 1000:
        return f'{int(ms)}ms'
    return f'{ms/1000:.2f}s'


def get_timestamp() -> str:
    """Get formatted timestamp"""
    if not DebugConfig.show_timestamp:
        return ''
    now = datetime.now()
    return f"{Colors.DIM}{now.strftime('%H:%M:%S')}.{now.microsecond // 1000:03d}{Colors.RESET} "


def format_cid(cid: Optional[str]) -> str:
    """Format correlation ID"""
    if not DebugConfig.show_correlation_id or not cid:
        return ''
    return f"{Colors.DIM}[{cid}]{Colors.RESET} "


class DebugLogger:
    """Main debug logger class"""

    def __init__(self, context: str):
        self.context = context

    def _should_log(self, level: str) -> bool:
        if not DebugConfig.enabled:
            return False
        return LOG_LEVELS.get(level, 0) >= LOG_LEVELS.get(DebugConfig.min_level, 0)

    def _log(
        self,
        level: str,
        emoji: str,
        tag: str,
        message: str,
        data: Optional[Dict[str, Any]] = None,
        cid: Optional[str] = None,
    ):
        if not self._should_log(level):
            return

        tag_color = TAG_COLORS.get(tag, Colors.WHITE)
        padded_tag = tag.ljust(7)

        line = f"{get_timestamp()}{format_cid(cid)}{emoji} {tag_color}{padded_tag}{Colors.RESET} {Colors.DIM}{self.context}{Colors.RESET} {message}"

        if data:
            data_parts = []
            for k, v in data.items():
                data_parts.append(f"{Colors.DIM}{k}={Colors.RESET}{format_value(v)}")
            line += ' ' + ' '.join(data_parts)

        print(line, flush=True)

    # =========== Flow Events ===========

    def recv(self, message: str, data: Optional[Dict] = None, cid: Optional[str] = None):
        """Incoming request received"""
        self._log('info', '📥', 'RECV', message, data, cid)

    def send(self, message: str, data: Optional[Dict] = None, cid: Optional[str] = None):
        """Outgoing response sent"""
        self._log('info', '📤', 'SEND', message, data, cid)

    def phase_a(self, message: str, data: Optional[Dict] = None, cid: Optional[str] = None):
        """Phase A processing"""
        self._log('info', '🔄', 'PHASE-A', message, data, cid)

    def phase_b(self, message: str, data: Optional[Dict] = None, cid: Optional[str] = None):
        """Phase B processing"""
        self._log('info', '🔄', 'PHASE-B', message, data, cid)

    def tool(self, message: str, data: Optional[Dict] = None, cid: Optional[str] = None):
        """Tool-related event"""
        self._log('info', '🔧', 'TOOL', message, data, cid)

    def state(self, message: str, data: Optional[Dict] = None, cid: Optional[str] = None):
        """State change"""
        self._log('debug', '💾', 'STATE', message, data, cid)

    def perf(self, message: str, ms: float, cid: Optional[str] = None):
        """Performance timing"""
        formatted = format_ms(ms)
        if ms < 100:
            color = Colors.GREEN
        elif ms < 500:
            color = Colors.YELLOW
        else:
            color = Colors.RED
        self._log('info', '⚡', 'PERF', message, {'time': f'{color}{formatted}{Colors.RESET}'}, cid)

    def ok(self, message: str, data: Optional[Dict] = None, cid: Optional[str] = None):
        """Success"""
        self._log('info', '✅', 'OK', message, data, cid)

    def err(self, message: str, data: Optional[Dict] = None, cid: Optional[str] = None):
        """Error"""
        self._log('error', '❌', 'ERR', message, data, cid)

    def warn(self, message: str, data: Optional[Dict] = None, cid: Optional[str] = None):
        """Warning"""
        self._log('warn', '⚠️ ', 'WARN', message, data, cid)

    def link(self, message: str, data: Optional[Dict] = None, cid: Optional[str] = None):
        """External service call"""
        self._log('info', '🔗', 'LINK', message, data, cid)

    def match(self, message: str, data: Optional[Dict] = None, cid: Optional[str] = None):
        """Pattern matching"""
        self._log('debug', '🎯', 'MATCH', message, data, cid)

    def ai(self, message: str, data: Optional[Dict] = None, cid: Optional[str] = None):
        """AI/LLM operation"""
        self._log('info', '🧠', 'AI', message, data, cid)

    def prompt(self, message: str, data: Optional[Dict] = None, cid: Optional[str] = None):
        """Prompt construction"""
        self._log('debug', '📝', 'PROMPT', message, data, cid)

    def mood(self, message: str, data: Optional[Dict] = None, cid: Optional[str] = None):
        """Mood calculation"""
        self._log('info', '😊', 'MOOD', message, data, cid)

    # =========== Utility Methods ===========

    def child(self, sub_context: str) -> 'DebugLogger':
        """Create a child logger with a sub-context"""
        return DebugLogger(f"{self.context}:{sub_context}")

    def separator(self, cid: Optional[str] = None):
        """Log a separator line for visual grouping"""
        if not self._should_log('debug'):
            return
        print(f"{get_timestamp()}{format_cid(cid)}{Colors.DIM}{'─' * 60}{Colors.RESET}")

    def timer(self, label: str, cid: Optional[str] = None) -> Callable[[], None]:
        """Start a timer and return a function to log the elapsed time"""
        start = time.time()
        def done():
            elapsed_ms = (time.time() - start) * 1000
            self.perf(label, elapsed_ms, cid)
        return done


def create_debug_logger(context: str) -> DebugLogger:
    """Create a debug logger for a specific context"""
    return DebugLogger(context)


# Singleton loggers for common contexts
class DebugLog:
    orchestrator = create_debug_logger('orchestrator')
    openai = create_debug_logger('openai')
    app = create_debug_logger('app')
    mood = create_debug_logger('mood')


debug_log = DebugLog()
