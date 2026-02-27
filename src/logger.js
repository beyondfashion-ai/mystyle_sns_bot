/**
 * 표준화된 로깅 유틸리티.
 * 모듈별 프리픽스 + 레벨(DEBUG/INFO/WARN/ERROR) 제공.
 *
 * 사용법:
 *   import { createLogger } from './logger.js';
 *   const log = createLogger('ModuleName');
 *   log.info('메시지');
 *   log.error('에러', err);
 */

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.INFO;

export function createLogger(module) {
    const prefix = `[${module}]`;

    return {
        debug(...args) {
            if (CURRENT_LEVEL <= LOG_LEVELS.DEBUG) console.debug(prefix, ...args);
        },
        info(...args) {
            if (CURRENT_LEVEL <= LOG_LEVELS.INFO) console.log(prefix, ...args);
        },
        warn(...args) {
            if (CURRENT_LEVEL <= LOG_LEVELS.WARN) console.warn(prefix, ...args);
        },
        error(msg, err) {
            if (CURRENT_LEVEL <= LOG_LEVELS.ERROR) {
                if (err instanceof Error) {
                    console.error(prefix, msg, err.message);
                    if (process.env.LOG_LEVEL?.toUpperCase() === 'DEBUG') {
                        console.error(err.stack);
                    }
                } else {
                    console.error(prefix, msg, err ?? '');
                }
            }
        },
    };
}
