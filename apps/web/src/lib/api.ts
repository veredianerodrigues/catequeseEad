export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  get isNetwork() {
    return this.status === 0;
  }
}

let csrfToken = "";
export const setCsrfToken = (t: string) => {
  csrfToken = t;
};

export const SESSION_EXPIRED_EVENT = "quiz:session-expired";

async function request<T>(path: string, init: RequestInit & { method: string }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      headers: { ...(init.method !== "GET" ? { "x-csrf-token": csrfToken } : {}), ...(init.headers as Record<string, string>) },
    });
  } catch {
    throw new ApiError(0, "Sem conexão com o servidor.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    throw new ApiError(res.status, data?.error ?? (res.status >= 500 ? "Servidor indisponível. Tente novamente." : "Erro inesperado."), data?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<T>(path, { method: "POST", body: form });
  },
};

/** Mensagem amigável + detalhes de validação (422/400) numa lista de linhas. */
export function errorLines(e: unknown): string[] {
  if (!(e instanceof ApiError)) return ["Erro inesperado."];
  const lines = [e.message];
  if (Array.isArray(e.details)) {
    for (const d of e.details) lines.push(typeof d === "string" ? d : `${d.path ? d.path + ": " : ""}${d.message}`);
  }
  return lines;
}
