import crypto from "node:crypto";

// Sem caracteres ambíguos (0/o, 1/l/i): o link costuma ser digitado ou lido em voz alta.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export const SHARE_CODE_RE = /^[a-z0-9]{6,32}$/;

/** 10 caracteres de um alfabeto de 31 símbolos (~50 bits), sorteados com `crypto.randomInt`. */
export function newShareCode(length = 10): string {
  return Array.from({ length }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("");
}
