import { Router } from "express";
import { Prisma, type PrismaClient } from "@prisma/client";
import { subjectInputSchema } from "@quiz/shared";
import { conflict, notFound } from "../lib/errors";

const paramId = (v: unknown) => String(v);
const duplicate = () => conflict("Já existe um assunto com esse nome.");

function mapDbError(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") throw duplicate();
    if (e.code === "P2025") throw notFound("Assunto");
  }
  throw e;
}

export function subjectsRouter(prisma: PrismaClient) {
  const r = Router();
  const withCount = { _count: { select: { questions: true } } };
  const view = ({ _count, ...s }: { _count: { questions: number } } & Record<string, unknown>) => ({ ...s, questionCount: _count.questions });

  r.get("/", async (req, res) => {
    const { q, status } = req.query as Record<string, string | undefined>;
    const items = await prisma.subject.findMany({
      where: { ...(q ? { name: { contains: q } } : {}), ...(status === "ACTIVE" || status === "INACTIVE" ? { status } : {}) },
      orderBy: { name: "asc" },
      include: withCount,
    });
    res.json(items.map(view));
  });

  r.post("/", async (req, res) => {
    const data = subjectInputSchema.parse(req.body);
    try {
      res.status(201).json(view(await prisma.subject.create({ data: { ...data, description: data.description || null }, include: withCount })));
    } catch (e) {
      mapDbError(e);
    }
  });

  r.put("/:id", async (req, res) => {
    const data = subjectInputSchema.parse(req.body);
    try {
      res.json(view(await prisma.subject.update({ where: { id: paramId(req.params.id) }, data: { ...data, description: data.description || null }, include: withCount })));
    } catch (e) {
      mapDbError(e);
    }
  });

  // Assunto com questões só pode ser inativado, nunca excluído.
  r.delete("/:id", async (req, res) => {
    const id = paramId(req.params.id);
    const subject = await prisma.subject.findUnique({ where: { id }, include: withCount });
    if (!subject) throw notFound("Assunto");
    if (subject._count.questions > 0) throw conflict("Este assunto possui questões e não pode ser excluído. Inative-o.");
    try {
      await prisma.subject.delete({ where: { id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") throw conflict("Este assunto possui questões e não pode ser excluído. Inative-o.");
      mapDbError(e);
    }
    res.status(204).end();
  });

  return r;
}
