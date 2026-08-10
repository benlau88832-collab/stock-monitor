// conceptFilter.js 的 TypeScript 声明（共享判定核心，纯 ESM）
export declare const BROAD_PATTERNS: RegExp[];
export declare const NON_THEME_PATTERNS: RegExp[];
export declare const THEME_HINTS: RegExp;
export declare function normalizeConceptName(name: string): string;
export declare function isBroadConcept(name: string): boolean;
export declare function isThemeBoardName(name: string, whitelist: Set<string> | null): boolean;
