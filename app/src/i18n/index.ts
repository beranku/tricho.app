/**
 * Public i18n API. Components should import from here only:
 *
 *   import { m, getLocale, setLocaleAndPersist } from '../../i18n';
 *   <span>{m.menu_clients()}</span>
 */
export { m } from '../paraglide/messages.js';
export {
  bootstrapLocale,
  getLocale,
  setLocale,
  setLocaleAndPersist,
  localeStore,
  __resetLocaleRuntimeForTests,
} from './runtime.ts';
export type { Locale } from './config.ts';
export { LOCALES, LOCALE_LABELS, DEFAULT_LOCALE, isLocale, resolveHostLocale } from './config.ts';
