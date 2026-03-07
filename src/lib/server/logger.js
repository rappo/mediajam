import { writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';

// Put logs next to the database in the persistent data directory
const DATA_DIR = dirname(process.env.DATABASE_PATH || resolve(process.cwd(), 'mediajam.sqlite'));
const LOG_DIR = join(DATA_DIR, 'logs');
const SESSION_ID = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const LOG_FILE = join(LOG_DIR, `mediajam-${SESSION_ID}.log`);

// Ensure logs directory exists
if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Logging levels
 * @typedef {'debug' | 'info' | 'warn' | 'error'} LogLevel
 */

/** @type {boolean | null} */
let _loggingEnabled = null;

/** @type {boolean} */
const IS_DEV = process.env.NODE_ENV !== 'production';

/**
 * Check if logging is enabled.
 * Priority: 1) admin override from DB, 2) env default (dev=on, prod=off)
 * @returns {boolean}
 */
function isEnabled() {
    if (_loggingEnabled !== null) return _loggingEnabled;
    return IS_DEV;
}

/**
 * Set the logging override from admin settings.
 * @param {boolean | null} enabled - null = use env default
 */
export function setLoggingEnabled(enabled) {
    _loggingEnabled = enabled;
}

/**
 * Initialize logging from DB settings.
 * Call this once at startup after DB is ready.
 * @param {any} db - better-sqlite3 database instance
 */
export function initLogging(db) {
    try {
        const row = /** @type {any} */ (db.prepare('SELECT logging_enabled FROM app_settings WHERE id = 1').get());
        if (row && row.logging_enabled !== null && row.logging_enabled !== undefined) {
            _loggingEnabled = !!row.logging_enabled;
        }
    } catch {
        // Column doesn't exist yet — use defaults
    }
    if (isEnabled()) {
        writeFileSync(LOG_FILE, `[${new Date().toISOString()}] Mediajam logger started (session: ${SESSION_ID}, dev: ${IS_DEV})\n`);
    }
}

/**
 * Format a log entry.
 * @param {LogLevel} level
 * @param {string} category
 * @param {string} message
 * @param {Record<string, any>} [meta]
 * @returns {string}
 */
function formatEntry(level, category, message, meta) {
    const ts = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${ts}] [${level.toUpperCase()}] [${category}] ${message}${metaStr}\n`;
}

/**
 * Write a log entry to the session log file.
 * @param {LogLevel} level
 * @param {string} category
 * @param {string} message
 * @param {Record<string, any>} [meta]
 */
function writeLog(level, category, message, meta) {
    if (!isEnabled()) return;
    try {
        appendFileSync(LOG_FILE, formatEntry(level, category, message, meta));
    } catch {
        // Silently fail if logging itself errors
    }
}

/**
 * Log a debug message.
 * @param {string} category - e.g. 'sync', 'people-sync', 'backfill'
 * @param {string} message
 * @param {Record<string, any>} [meta]
 */
export function logDebug(category, message, meta) {
    writeLog('debug', category, message, meta);
}

/**
 * Log an info message.
 * @param {string} category
 * @param {string} message
 * @param {Record<string, any>} [meta]
 */
export function logInfo(category, message, meta) {
    writeLog('info', category, message, meta);
}

/**
 * Log a warning.
 * @param {string} category
 * @param {string} message
 * @param {Record<string, any>} [meta]
 */
export function logWarn(category, message, meta) {
    writeLog('warn', category, message, meta);
}

/**
 * Log an error.
 * @param {string} category
 * @param {string} message
 * @param {Record<string, any>} [meta]
 */
export function logError(category, message, meta) {
    writeLog('error', category, message, meta);
}

/**
 * Get the current log file path.
 * @returns {string}
 */
export function getLogFilePath() {
    return LOG_FILE;
}

/**
 * Get the logs directory path.
 * @returns {string}
 */
export function getLogDir() {
    return LOG_DIR;
}
