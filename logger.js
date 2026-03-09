const fs = require('fs');
const path = require('path');

const MAX_LOG_SIZE = 2 * 1024 * 1024; // 2 MB
const MAX_ROTATED = 1;

let logDir = null;
let logPath = null;

/**
 * Initialise logger. Call once after app.getPath('userData') is available.
 */
function init(userDataDir) {
  logDir = path.join(userDataDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  logPath = path.join(logDir, 'app.log');
  rotate();
  info('logger', `Log file: ${logPath}`);
}

function rotate() {
  try {
    if (!fs.existsSync(logPath)) return;
    const stat = fs.statSync(logPath);
    if (stat.size < MAX_LOG_SIZE) return;
    const rotated = logPath + '.1';
    if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
    fs.renameSync(logPath, rotated);
  } catch { /* ignore rotation errors */ }
}

function write(level, tag, message, extra) {
  if (!logPath) return;
  const ts = new Date().toISOString();
  let line = `[${ts}] [${level}] [${tag}] ${message}`;
  if (extra !== undefined) {
    line += ' ' + (typeof extra === 'string' ? extra : JSON.stringify(extra));
  }
  line += '\n';

  try {
    fs.appendFileSync(logPath, line, 'utf8');
  } catch { /* ignore write errors */ }
}

function info(tag, message, extra) {
  write('INFO', tag, message, extra);
}

function warn(tag, message, extra) {
  write('WARN', tag, message, extra);
}

function error(tag, message, extra) {
  write('ERROR', tag, message, extra);
}

/**
 * Returns the path to the log directory (for showing to user).
 */
function getLogPath() {
  return logPath;
}

module.exports = { init, info, warn, error, getLogPath };
