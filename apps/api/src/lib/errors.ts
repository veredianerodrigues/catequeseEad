export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Recurso") => new HttpError(404, `${what} não encontrado`);
export const forbidden = () => new HttpError(403, "Acesso negado");
export const unauthorized = () => new HttpError(401, "Sessão ausente ou expirada");
export const conflict = (m: string) => new HttpError(409, m);
export const unprocessable = (m: string, details?: unknown) => new HttpError(422, m, details);
