import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt) as (password: string, salt: Buffer, keylen: number, options: crypto.ScryptOptions) => Promise<Buffer>;

// Parâmetros do scrypt gravados junto do hash, para poder aumentá-los no futuro sem invalidar senhas antigas.
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

/** Formato: scrypt$N$r$p$salt(base64url)$hash(base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

let dummy: Promise<string> | undefined;
/** Gasta o mesmo tempo de uma verificação real quando o e-mail não existe (evita revelar quais e-mails têm conta). */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummy ??= hashPassword("senha-ficticia-para-igualar-o-tempo");
  await verifyPassword(password, await dummy);
}

// Sem 0/O, 1/l/I: a senha temporária é lida e digitada por pessoas.
const TEMP_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function temporaryPassword(length = 10): string {
  return Array.from({ length }, () => TEMP_ALPHABET[crypto.randomInt(TEMP_ALPHABET.length)]).join("");
}
